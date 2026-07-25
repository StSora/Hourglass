/**
 * Compound agent runner (SCAFFOLD) — harvests an LP position's fees and reinvests
 * them into the SAME position, under a signed compound mandate. See
 * src/lib/compoundDelegation.ts and src/lib/compounding.ts.
 *
 * The DECISION is the valuable part and is concrete: it uses the SAME optimizer the
 * app card shows (`projectAgentOptimal`) so the agent compounds at the frequency that
 * maximises return after gas — never greedily, never at a loss, and at least as good
 * as any fixed schedule. In Manual mode it follows the operator's interval instead.
 *
 * Status: scaffold. The decision + redeem wiring (mirroring src/lib/redeemDirect.ts)
 * are concrete. Three on-chain parts are marked TODO and must be closed before a live
 * run:
 *   - discovering the Safe's position `tokenId` in the PositionManager;
 *   - encoding the `collect` and `increaseLiquidity` calldata;
 *   - reading the live position value / APR / gas at run time.
 *
 * Run with: bun run scripts/compound-agent.ts   (after wiring the env + TODOs)
 */
import {
  createExecution,
  ExecutionMode,
  type Delegation,
} from '@metamask/smart-accounts-kit'
import { encodePermissionContexts, encodeExecutionCalldatas } from '@metamask/smart-accounts-kit/utils'
import { createPublicClient, createWalletClient, encodeFunctionData, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getAddresses } from '../src/config/addresses'
import { projectAgentOptimal, type CompoundingConfig } from '../src/lib/compounding'
import type { StoredDelegation } from '../src/lib/storage'

// --- Config (fail loud, no silent fallbacks) -------------------------------

type CompoundMode = 'agent' | 'manual'

interface AgentConfig {
  rpcUrl: string
  agentPrivateKey: Hex
  chainId: number
  pollMs: number
  maxConsecutiveReverts: number
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function loadConfig(): AgentConfig {
  return {
    rpcUrl: requireEnv('CMP_RPC_URL'),
    agentPrivateKey: requireEnv('CMP_AGENT_PRIVATE_KEY') as Hex,
    chainId: Number(requireEnv('CMP_CHAIN_ID')),
    pollMs: Number(process.env.CMP_POLL_MS ?? '3600000'), // 1h
    maxConsecutiveReverts: Number(process.env.CMP_MAX_REVERTS ?? '5'),
  }
}

// --- The mandate the agent redeems -----------------------------------------

interface LoadedMandate {
  delegation: StoredDelegation['delegation']
  positionManager: Address
  mode: CompoundMode
  /** Manual only. */
  intervalDays: number | null
  /** The LP position to compound. */
  tokenId: bigint
}

/**
 * TODO(compounding): load the signed compound mandate + its terms (mode, interval,
 * positionManager, pool) from the yield plan, and discover the Safe's `tokenId` in
 * the PositionManager (query balanceOf + tokenOfOwnerByIndex, or the mint receipt).
 */
function loadMandate(): LoadedMandate {
  throw new Error('loadMandate: wire the signed compound mandate + terms + tokenId.')
}

// --- Live position economics (read at run time) ----------------------------

interface PositionEconomics {
  /** Current position value in base-token units (USD-ish). */
  principal: number
  /** Current APR as a fraction. */
  apr: number
  /** Estimated gas cost of one compound tx, base-token units. */
  gasCost: number
  /** Days since the last compound (or since the position was opened). */
  daysSinceLastCompound: number
}

/**
 * TODO(compounding): read live values — position value + fees (PositionManager
 * positions(tokenId)), pool APR (fees/TVL), and current gas price x units x token
 * price. This is where the agent gets the REAL gas, unlike the card's estimate.
 */
function readPositionEconomics(): PositionEconomics {
  throw new Error('readPositionEconomics: wire live position value / APR / gas reads.')
}

// --- The decision (concrete — same optimizer as the app) -------------------

const HORIZON_DAYS = 365

/**
 * Decide whether to compound now. Agent mode targets the optimal interval from
 * `projectAgentOptimal`; Manual follows the operator's fixed interval.
 */
export function isCompoundDue(
  econ: PositionEconomics,
  mode: CompoundMode,
  intervalDays: number | null,
): { due: boolean; targetIntervalDays: number } {
  const config: CompoundingConfig = { principal: econ.principal, apr: econ.apr, gasCost: econ.gasCost }
  const targetIntervalDays =
    mode === 'agent'
      ? projectAgentOptimal(config, HORIZON_DAYS).intervalDays
      : (intervalDays ?? Infinity)
  const due = Number.isFinite(targetIntervalDays) && econ.daysSinceLastCompound >= targetIntervalDays
  return { due, targetIntervalDays }
}

// --- Execute: collect + increaseLiquidity via the mandate ------------------

const REDEEM_DELEGATIONS_ABI = [
  {
    type: 'function',
    name: 'redeemDelegations',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_permissionContexts', type: 'bytes[]' },
      { name: '_modes', type: 'bytes32[]' },
      { name: '_executionCallDatas', type: 'bytes[]' },
    ],
    outputs: [],
  },
] as const

/**
 * TODO(compounding): build the `collect` and `increaseLiquidity` calldata for this
 * tokenId (PositionManager ABI). collect harvests fees to the Safe; increaseLiquidity
 * reinvests them into the same position. Requires a standing Safe->PositionManager
 * approval (setup tx).
 */
function buildCompoundExecutions(mandate: LoadedMandate): { target: Address; value: bigint; callData: Hex }[] {
  void mandate
  throw new Error('buildCompoundExecutions: encode collect + increaseLiquidity for the tokenId.')
}

function buildRedeemTx(
  cfg: AgentConfig,
  delegation: StoredDelegation['delegation'],
  executions: { target: Address; value: bigint; callData: Hex }[],
): { to: Address; data: Hex } {
  const { delegationManager } = getAddresses(cfg.chainId)

  const sdkDelegation: Delegation = {
    delegate: delegation.delegate,
    delegator: delegation.delegator,
    authority: delegation.authority,
    caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: '0x' })),
    salt: delegation.salt,
    signature: delegation.signature,
  }

  // Each compound is two calls (collect, then increaseLiquidity). They redeem the
  // same standing mandate sequentially — the delegation allows both methods and is
  // repeatable. (Batch mode is avoided; functionCall caveats are per-execution.)
  const sdkExecutions = executions.map((e) => createExecution({ target: e.target, value: e.value, callData: e.callData }))

  const data = encodeFunctionData({
    abi: REDEEM_DELEGATIONS_ABI,
    functionName: 'redeemDelegations',
    args: [
      encodePermissionContexts(sdkExecutions.map(() => [sdkDelegation])),
      sdkExecutions.map(() => ExecutionMode.SingleDefault),
      encodeExecutionCalldatas(sdkExecutions.map((e) => [e])),
    ],
  })

  return { to: delegationManager, data }
}

// --- Runner ----------------------------------------------------------------

async function runOnce(cfg: AgentConfig, mandate: LoadedMandate): Promise<'compounded' | 'waiting' | 'reverted'> {
  const econ = readPositionEconomics()
  const { due } = isCompoundDue(econ, mandate.mode, mandate.intervalDays)
  if (!due) return 'waiting'

  const executions = buildCompoundExecutions(mandate)
  const tx = buildRedeemTx(cfg, mandate.delegation, executions)

  const agent = privateKeyToAccount(cfg.agentPrivateKey)
  const publicClient = createPublicClient({ transport: http(cfg.rpcUrl) })
  const walletClient = createWalletClient({ account: agent, transport: http(cfg.rpcUrl) })

  try {
    await publicClient.call({ account: agent.address, to: tx.to, data: tx.data })
    const hash = await walletClient.sendTransaction({ to: tx.to, data: tx.data, chain: null })
    await publicClient.waitForTransactionReceipt({ hash })
    return 'compounded'
  } catch {
    return 'reverted'
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig()
  const mandate = loadMandate()

  let consecutiveReverts = 0
  for (;;) {
    const outcome = await runOnce(cfg, mandate)
    if (outcome === 'reverted') {
      consecutiveReverts += 1
      if (consecutiveReverts >= cfg.maxConsecutiveReverts) {
        throw new Error(`Circuit breaker: ${consecutiveReverts} consecutive reverts — stopping.`)
      }
    } else {
      consecutiveReverts = 0
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

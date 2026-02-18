/***********/
// SOURCES //
/***********/

export interface SourceInputUrls {
  /** Hash of the source file. It is used to verify the retrieved content imported via URLs */
  keccak256?: string
  /**
   * URL(s) to the source file.
   * URL(s) should be imported in this order and the result checked against the
   * keccak256 hash (if available). If the hash doesn't match or none of the
   * URL(s) result in success, an error should be raised.
   */
  urls: string[]
}
export interface SourceInputContent {
  /** Hash of the source file. */
  keccak256?: string
  /** Literal contents of the source file */
  content: string
}

export interface SourcesInput {
  [contractName: string]: SourceInputContent | SourceInputUrls
}

/********************/
// OUTPUT SELECTION //
/********************/
export type OutputType =
  | 'abi'
  | 'devdoc'
  | 'userdoc'
  | 'metadata'
  | 'ir'
  | 'irOptimized'
  | 'storageLayout'
  | 'evm.assembly'
  | 'evm.legacyAssembly'
  | 'evm.bytecode.functionDebugData'
  | 'evm.bytecode.object'
  | 'evm.bytecode.opcodes'
  | 'evm.bytecode.sourceMap'
  | 'evm.bytecode.linkReferences'
  | 'evm.bytecode.generatedSources'
  | 'evm.deployedBytecode'
  | 'evm.deployedBytecode.immutableReferences'
  | 'evm.methodIdentifiers'
  | 'evm.gasEstimates'
  | 'ewasm.wast'
  | 'ewasm.wasm'

export interface CompilerOutputSelection {
  [file: string]: {
    [contract: string]: OutputType[]
  }
}

export interface CompilerModelChecker {
  /**
   * Chose which contracts should be analyzed as the deployed one.
   * - key is the contract path
   * - value is an array of contract's name in the file
   */
  contracts: {
    [contractPath: string]: string[];
  }
  /**
   * Choose whether division and modulo operations should be replaced by multiplication with slack variables.
   * Default is `true`.
   * Using `false` here is recommended if you are using the CHC engine and not using Spacer as the Horn solver (using Eldarica, for example).
   * See the Formal Verification section for a more detailed explanation of this option.
   */
  divModWithSlacks?: boolean
  /** Choose which model checker engine to use: all (default), bmc, chc, none. */
  engine?: 'all' | 'bmc' | 'chc' | 'none'
  /** Choose which types of invariants should be reported to the user: contract, reentrancy. */
  invariants: ('contract' | 'reentrancy')[]
  /** Choose whether to output all unproved targets. The default is `false`. */
  showUnproved?: boolean
  /** Choose which solvers should be used, if available. See the Formal Verification section for the solvers description. */
  solvers: ('cvc4' | 'smtlib2' | 'z3')[]
  /**
   * Choose which targets should be checked: constantCondition, underflow, overflow, divByZero, balance, assert, popEmptyArray, outOfBounds.
   * If the option is not given all targets are checked by default, except underflow/overflow for Solidity >=0.8.7.
   * See the Formal Verification section for the targets description.
   */
  targets?: ('constantCondition' | 'underflow' | 'overflow' | 'divByZero' | 'balance' | 'assert' | 'popEmptyArray' | 'outOfBounds')[]
  /**
   * Timeout for each SMT query in milliseconds.
   * If this option is not given, the SMTChecker will use a deterministic resource limit by default.
   * A given timeout of 0 means no resource/time restrictions for any query.
   */
  timeout?: number
}

/************/
// SETTINGS //
/************/
export type EvmVersion = 'london' | 'berlin' | 'istanbul' | 'petersburg' | 'constantinople' | 'byzantium' | 'spuriousDragon' | 'tangerineWhistle' | 'homestead';

export interface CompilerOptimizerDetails {
  /** The peephole optimizer is always on if no details are given, use details to switch it off. */
  peephole: boolean;
  /** The inliner is always on if no details are given, use details to switch it off. */
  inliner: boolean;
  /** The unused jumpdest remover is always on if no details are given, use details to switch it off. */
  jumpdestRemover: boolean;
  /** Sometimes re-orders literals in commutative operations. */
  orderLiterals: boolean;
  /** Removes duplicate code blocks */
  deduplicate: boolean;
  /** Common subexpression elimination, this is the most complicated step but can also provide the largest gain. */
  cse: boolean;
  /** Optimize representation of literal numbers and strings in code. */
  constantOptimizer: boolean;
  /**
   * The new Yul optimizer. Mostly operates on the code of ABI coder v2 and inline assembly.
   * It is activated together with the global optimizer setting and can be deactivated here.
   * Before Solidity 0.6.0 it had to be activated through this switch.
   */
  yul: boolean;
  /** Tuning options for the Yul optimizer. */
  yulDetails: {
    /**
     * Improve allocation of stack slots for variables, can free up stack slots early.
     * Activated by default if the Yul optimizer is activated.
     */
    stackAllocation: boolean;
    /** Select optimization steps to be applied. The optimizer will use the default sequence if omitted. */
    optimizerSteps?: string;
  }
}

export interface CompileDebug {
/**
 * How to treat revert (and require) reason strings. Settings are "default", "strip", "debug" and "verboseDebug".
 * - `"default"` does not inject compiler-generated revert strings and keeps user-supplied ones.
 * - `"strip"` removes all revert strings (if possible, i.e. if literals are used) keeping side-effects
 * - `"debug"` injects strings for compiler-generated internal reverts, implemented for ABI encoders V1 and V2 for now.
 * - `"verboseDebug"` even appends further information to user-supplied revert strings (not yet implemented)
 */
revertStrings?: 'default' | 'strip' | 'debug' | 'verboseDebug'
/**
 * How much extra debug information to include in comments in the produced EVM assembly and Yul code. Available components are:
 * - `location`: Annotations of the form `@src <index>:<start>:<end>` indicating the location of the corresponding element in the original Solidity file, where:
 *  1. `<index>` is the file index matching the `@use-src` annotation,
 *  2. `<start>` is the index of the first byte at that location,
 *  3. `<end>` is the index of the first byte after that location.
 * - `snippet`: A single-line code snippet from the location indicated by `@src`. The snippet is quoted and follows the corresponding `@src` annotation.
 * - `*`: Wildcard value that can be used to request everything.
 */
debugInfo?: ('location' | 'snippet' | '*')[]
}

export interface CompilerMetadata {
/** Use only literal content and not URLs (false by default) */
useLiteralContent: boolean
/**
 * Use the given hash method for the metadata hash that is appended to the bytecode.
 * The metadata hash can be removed from the bytecode via option "none".
 * If the option is omitted, "ipfs" is used by default..
 */
bytecodeHash?: 'ipfs' | 'bzzr1' | 'none';
}

/**
* The top level key is the the name of the source file where the library is used.
* If remappings are used, this source file should match the global path after remappings were applied.
* If this key is an empty string, that refers to a global level.
*/
export interface CompilerLibraries {
[contractName: string]: {
  [libName: string]: string
}
}

export interface CompilerOptimizer {
  /** disabled by default */
  enable: boolean
  /**
   * Optimize for how many times you intend to run the code.
   * Lower values will optimize more for initial deployment cost, higher values will optimize more for high-frequency usage.
   */
  runs: number
  /** Switch optimizer components on or off in detail.
   * The "enabled" switch above provides two defaults which can be
   * tweaked here. If "details" is given, "enabled" can be omitted.
   */
  details: Partial<CompilerOptimizerDetails>
}

export interface CompilerSettings {
  /** Stop compilation after the given stage. Currently only "parsing" is valid here */
  stopAfter?: 'parsing'
  /** Sorted list of remappings */
  remappings?: string[]
  /** Optimizer settings */
  optimizer?: Partial<CompilerOptimizer>
  /** Version of the EVM to compile for. Affects type checking and code generation */
  evmVersion: EvmVersion;
  /**
   * Change compilation pipeline to go through the Yul intermediate representation.
   * This is a highly EXPERIMENTAL feature, not to be used for production. This is false by default.
   */
  viaIR?: boolean
  /** Debugging settings */
  debug?: CompileDebug
  /** Metadata settings */
  metadata?: CompilerMetadata
  /** Addresses of the libraries. If not all libraries are given here, it can result in unlinked objects whose output data is different. */
  libraries: CompilerLibraries
  /**
   * The following can be used to select desired outputs.
   * If this field is omitted, then the compiler loads and does type checking, but will not generate any outputs apart from errors.
   * The first level key is the file name and the second is the contract name, where empty contract name refers to the file itself,
   * while the star refers to all of the contracts.
   * Note that using a using `evm`, `evm.bytecode`, `ewasm`, etc. will select every
   * target part of that output. Additionally, `*` can be used as a wildcard to request everything.
   * Contract level (needs the contract name or "*"):
   * - abi - ABI
   * - devdoc - Developer documentation (natspec)
   * - userdoc - User documentation (natspec)
   * - metadata - Metadata
   * - ir - Yul intermediate representation of the code before optimization
   * - irOptimized - Intermediate representation after optimization
   * - storageLayout - Slots, offsets and types of the contract's state variables.
   * - evm.assembly - New assembly format
   * - evm.legacyAssembly - Old-style assembly format in JSON
   * - evm.bytecode.functionDebugData - Debugging information at function level
   * - evm.bytecode.object - Bytecode object
   * - evm.bytecode.opcodes - Opcodes list
   * - evm.bytecode.sourceMap - Source mapping (useful for debugging)
   * - evm.bytecode.linkReferences - Link references (if unlinked object)
   * - evm.bytecode.generatedSources - Sources generated by the compiler
   * - evm.deployedBytecode* - Deployed bytecode (has all the options that evm.bytecode has)
   * - evm.deployedBytecode.immutableReferences - Map from AST ids to bytecode ranges that reference immutables
   * - evm.methodIdentifiers - The list of function hashes
   * - evm.gasEstimates - Function gas estimates
   * - ewasm.wast - Ewasm in WebAssembly S-expressions format
   * - ewasm.wasm - Ewasm in WebAssembly binary format
   */
  outputSelection?: CompilerOutputSelection
  /** The modelChecker object is experimental and subject to changes. */
  modelChecker?: CompilerModelChecker
}

export interface CompilationInput {
  /** Source code language */
  language: 'Solidity' | 'yul'
  sources: SourcesInput
  settings?: CompilerSettings
}

export interface CondensedCompilationInput {
  language: 'Solidity' | 'Vyper' | 'lll' | 'assembly' | 'yul'
  optimize: boolean
  /** e.g: 0.6.8+commit.0bbfe453 */
  version: string
  evmVersion?: EvmVersion
}

/*********/
// ERROR //
/*********/

export interface SourceLocation {
  file: string
  start: number
  end: number
  message?: string
}

export type CompilationErrorType =
| 'JSONError'
| 'IOError'
| 'ParserError'
| 'DocstringParsingError'
| 'SyntaxError'
| 'DeclarationError'
| 'TypeError'
| 'UnimplementedFeatureError'
| 'InternalCompilerError'
| 'Exception'
| 'CompilerError'
| 'FatalError'
| 'Warning';

export interface CompilationError {
  /** Location within the source file */
  sourceLocation?: SourceLocation
  /** Further locations (e.g. places of conflicting declarations) */
  secondarySourceLocations?: SourceLocation[],
  /** Error type */
  type: CompilationErrorType
  /** Component where the error originated, such as "general", "ewasm", etc. */
  component: 'general' | 'ewasm' | string
  severity: 'error' | 'warning' | 'info'
  /** unique code for the cause of the error */
  errorCode?: string
  message: string
  /** the message formatted with source location */
  formattedMessage?: string
}

/*******/
// AST //
/*******/
export interface AstNode {
  absolutePath?: string
  exportedSymbols?: Record<string, unknown>
  id: number
  nodeType: string
  nodes?: Array<AstNode>
  src: string
  literals?: Array<string>
  file?: string
  scope?: number
  sourceUnit?: number
  symbolAliases?: Array<string>
  [x: string]: any
}

export interface AstNodeAtt {
  operator?: string
  string?: null
  type?: string
  value?: string
  constant?: boolean
  name?: string
  public?: boolean
  exportedSymbols?: Record<string, unknown>
  argumentTypes?: null
  absolutePath?: string
  [x: string]: any
}

export interface AstNodeLegacy {
  id: number
  name: string
  src: string
  children?: Array<AstNodeLegacy>
  attributes?: AstNodeAtt
}

/**********/
// SOURCE //
/**********/
export interface CompilationSource {
  /** Identifier of the source (used in source maps) */
  id: number
  /** The AST object */
  ast: AstNode
  /** The legacy AST object */
  legacyAST: AstNodeLegacy
}

/*******/
// ABI //
/*******/
type bytes = '8' | '16' | '32' | '64' | '128' | '256';

type ABISingleTypeParameter =
| 'string'
| 'uint'
| 'int'
| 'address'
| 'bool'
| 'fixed'
| `fixed${bytes}`
| 'ufixed'
| `ufixed${bytes}`
| 'bytes'
| `bytes${bytes}`
| 'function'
| 'tuple';

type ABIArrayType<T extends string> = `${T}[]` | `${T}[${number}]`;

export type ABITypeParameter = ABISingleTypeParameter | ABIArrayType<ABISingleTypeParameter>;

export interface ABIParameter {
  /** The name of the parameter */
  name: string;
  /** The canonical type of the parameter */
  type: ABITypeParameter;
  /** Used for tuple types */
  components?: ABIParameter[];
  /**
   * @example "struct StructName"
   * @example "struct Contract.StructName"
   */
  internalType?: string;
}

interface ABIEventParameter extends ABIParameter {
  /** true if the field is part of the log’s topics, false if it one of the log’s data segment. */
  indexed: boolean;
}

export interface FunctionDescription {
  /** Type of the method. default is 'function' */
  type?: 'function' | 'constructor' | 'fallback' | 'receive';
  /** The name of the function. Constructor and fallback functions never have a name */
  name?: string;
  /** List of parameters of the method. Fallback functions don’t have inputs. */
  inputs?: ABIParameter[];
  /** List of the output parameters for the method, if any */
  outputs?: ABIParameter[];
  /** State mutability of the method */
  stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
  /** true if function accepts Ether, false otherwise. Default is false */
  payable?: boolean;
  /** true if function is either pure or view, false otherwise. Default is false  */
  constant?: boolean;
}

export interface EventDescription {
  type: 'event';
  name: string;
  inputs: ABIEventParameter[];
  /** true if the event was declared as anonymous. */
  anonymous: boolean;
}

export interface ErrorDescription {
  type: 'error';
  name: string;
  inputs: ABIEventParameter[];
}

export type ABIDescription = FunctionDescription | EventDescription | ErrorDescription;

/*************************/
// NATURAL SPECIFICATION //
/*************************/
export interface UserMethodDoc {
  notice: string
}

export type UserMethodList = {
  [functionIdentifier: string]: UserMethodDoc
} & {
  'constructor'?: string
}

export interface DevMethodDoc {
  author: string
  details: string
  return: string
  returns: {
    [param: string]: string
  }
  params: {
    [param: string]: string
  }
}

export interface DevMethodList {
  [functionIdentifier: string]: DevMethodDoc
}

// Devdoc
export interface DeveloperDocumentation {
  author: string
  title: string
  details: string
  methods: DevMethodList
}

// Userdoc
export interface UserDocumentation {
  methods: UserMethodList
  notice: string
}

/**************/
// EVM OUTPUT //
/**************/

export interface FunctionDebugData {
  /** Byte offset into the bytecode where the function starts */
  entryPoint: number;
  /** AST ID of the function definition or null for compiler-internal functions */
  id: number;
  /** Number of EVM stack slots for the function parameters */
  parameterSlots: number;
  /** Number of EVM stack slots for the return values */
  returnSlots: number;
}

export interface GeneratedSources {
    /** Yul AST */
    ast: Record<string, unknown> // TODO: Find Yul AST type
    /** Source file in its text form (may contain comments) */
    contents: string
    /** Source file ID, used for source references, same namespace as the Solidity source files */
    id: number
    language: 'Yul'
    name: string
}

export interface GasEstimates {
  creation: {
    codeDepositCost: string
    executionCost: 'infinite' | string
    totalCost: 'infinite' | string
  }
  external: {
    [functionIdentifier: string]: string
  }
  internal: {
    [functionIdentifier: string]: 'infinite' | string
  }
}

export interface BytecodeObject {
  /**
   * Debugging data at the level of functions.
   * Set of functions including compiler-internal and user-defined function.
   */
  functionDebugData: {
    [internalName: string]: Partial<FunctionDebugData>
  }
  /** The bytecode as a hex string. */
  object: string
  /** Opcodes list */
  opcodes: string
  /** The source mapping as a string. See the source mapping definition. */
  sourceMap: string
  /** Array of sources generated by the compiler. Currently only contains a single Yul file. */
  generatedSources: GeneratedSources[],
  /** If given, this is an unlinked object. */
  linkReferences?: {
    [contractName: string]: {
      /** Byte offsets into the bytecode. */
      [library: string]: { start: number; length: number }[]
    }
  }
}

export interface EvmOutputs {
  assembly: string
  legacyAssembly: Record<string, unknown>
  /** Bytecode and related details. */
  bytecode: BytecodeObject
  deployedBytecode: BytecodeObject
  /** The list of function hashes */
  methodIdentifiers: {
    [functionIdentifier: string]: string
  }
  /** Function gas estimates */
  gasEstimates: GasEstimates
}

/***********/
// SOURCES //
/***********/
export interface CompilationFileSources {
  [fileName: string]: {
    // Optional: keccak256 hash of the source file
    keccak256?: string,
    // Required (unless "urls" is used): literal contents of the source file
    content: string,
    urls?: string[]
  }
}

export interface SourceWithTarget {
  sources?: CompilationFileSources,
  target?: string | null | undefined
}

/************/
// CONTRACT //
/************/
export interface CompiledContract {
  /** The Ethereum Contract ABI. If empty, it is represented as an empty array. */
  abi: ABIDescription[]
  // See the Metadata Output documentation (serialised JSON string)
  metadata: string
  /** User documentation (natural specification) */
  userdoc: UserDocumentation
  /** Developer documentation (natural specification) */
  devdoc: DeveloperDocumentation
  /** Intermediate representation (string) */
  ir: string
  /** EVM-related outputs */
  evm: EvmOutputs
  /** eWASM related outputs */
  ewasm: {
    /** S-expressions format */
    wast: string
    /** Binary format (hex string) */
    wasm: string
  }
}

/**********/
// RESULT //
/**********/

export interface CompilationResult {
  /** not present if no errors/warnings were encountered */
  errors?: CompilationError[]
  /** This contains the file-level outputs. In can be limited/filtered by the outputSelection settings */
  sources: {
    [contractName: string]: CompilationSource
  }
  /** This contains the contract-level outputs. It can be limited/filtered by the outputSelection settings */
  contracts: {
    /** If the language used has no contract names, this field should equal to an empty string. */
    [fileName: string]: {
      [contract: string]: CompiledContract
    }
  }
}

export interface lastCompilationResult {
  data: CompilationResult | null
  source: SourceWithTarget | null | undefined
}

/***************/
// TYPE GUARDS //
/***************/

export function isEvent (description: ABIDescription): description is EventDescription {
  return description.type === 'event';
}

export function isError (description: ABIDescription): description is ErrorDescription {
  return description.type === 'error';
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REOWN_PROJECT_ID: string
  readonly VITE_LOCAL_RPC: string
  readonly VITE_BUNDLER_RPC: string
  readonly VITE_CHAIN_ID: string
  readonly VITE_SNAP_ID?: string
  readonly VITE_ENTRYPOINT: string
  readonly VITE_KERNEL_ACCOUNT: string
  readonly VITE_PQ_VALIDATOR_MODULE: string
  readonly VITE_STYLUS_VERIFIER: string
  readonly VITE_ECDSA_VALIDATOR: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

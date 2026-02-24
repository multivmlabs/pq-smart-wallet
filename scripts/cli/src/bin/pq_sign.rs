use std::path::PathBuf;

use clap::Parser;
use ml_dsa::{MlDsa65, SigningKey, signature::Signer};

#[derive(Parser)]
#[command(about = "Sign a 32-byte hash with ML-DSA-65")]
struct Args {
    /// Path to seed file (sk.bin, 32 bytes)
    #[arg(long)]
    key: PathBuf,

    /// Hex-encoded 32-byte hash to sign (with or without 0x prefix)
    #[arg(long)]
    hash: String,

    /// Output path for signature
    #[arg(long)]
    output: PathBuf,
}

fn main() {
    let args = Args::parse();

    let seed_bytes = std::fs::read(&args.key).expect("failed to read seed file");
    let seed_arr: [u8; 32] = seed_bytes
        .try_into()
        .expect("seed must be exactly 32 bytes");
    let sk = SigningKey::<MlDsa65>::from_seed(&seed_arr.into());

    let hash_hex = args.hash.strip_prefix("0x").unwrap_or(&args.hash);
    let hash_bytes = hex::decode(hash_hex).expect("invalid hex in --hash");
    assert!(hash_bytes.len() == 32, "hash must be exactly 32 bytes");

    let sig = sk.sign(&hash_bytes);

    let sig_encoded = sig.encode();
    std::fs::write(&args.output, &sig_encoded[..]).expect("failed to write signature");

    println!("Signature written to {} (3309 bytes)", args.output.display());
}
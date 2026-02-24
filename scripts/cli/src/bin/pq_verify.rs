use std::path::PathBuf;

use clap::Parser;
use ml_dsa::{MlDsa65, signature::Verifier};

#[derive(Parser)]
#[command(about = "Verify an ML-DSA-65 signature against a 32-byte hash")]
struct Args {
    /// Path to public key (pk.bin)
    #[arg(long)]
    key: PathBuf,

    /// Hex-encoded 32-byte hash (with or without 0x prefix)
    #[arg(long)]
    hash: String,

    /// Path to signature file (sig.bin)
    #[arg(long)]
    sig: PathBuf,
}

fn main() {
    let args = Args::parse();

    let pk_bytes = std::fs::read(&args.key).expect("failed to read public key");
    let pk_arr: [u8; 1952] = pk_bytes
        .try_into()
        .expect("public key must be exactly 1952 bytes");
    let pk = ml_dsa::VerifyingKey::<MlDsa65>::decode(&pk_arr.into());

    let hash_hex = args.hash.strip_prefix("0x").unwrap_or(&args.hash);
    let hash_bytes = hex::decode(hash_hex).expect("invalid hex in --hash");
    assert!(hash_bytes.len() == 32, "hash must be exactly 32 bytes");

    let sig_bytes = std::fs::read(&args.sig).expect("failed to read signature");
    let sig = ml_dsa::Signature::<MlDsa65>::try_from(sig_bytes.as_slice())
        .expect("invalid signature (must be 3309 bytes)");

    match pk.verify(&hash_bytes, &sig) {
        Ok(()) => println!("Valid"),
        Err(_) => {
            println!("Invalid");
            std::process::exit(1);
        }
    }
}
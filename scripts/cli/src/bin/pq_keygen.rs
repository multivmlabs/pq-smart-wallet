use std::path::PathBuf;

use clap::Parser;
use ml_dsa::{KeyGen, MlDsa65};

#[derive(Parser)]
#[command(about = "Generate an ML-DSA-65 keypair")]
struct Args {
    /// Output directory for pk.bin and sk.bin
    #[arg(long)]
    output: PathBuf,
}

fn main() {
    let args = Args::parse();

    std::fs::create_dir_all(&args.output).expect("failed to create output directory");

    let mut rng = rand::rng();
    let kp: ml_dsa::KeyPair<MlDsa65> = MlDsa65::key_gen(&mut rng);

    let pk_path = args.output.join("pk.bin");
    let sk_path = args.output.join("sk.bin");

    let pk_encoded = kp.verifying_key().encode();
    let seed = kp.to_seed();

    std::fs::write(&pk_path, &pk_encoded[..]).expect("failed to write public key");
    std::fs::write(&sk_path, &seed[..]).expect("failed to write seed");

    println!("Public key:  {} (1952 bytes)", pk_path.display());
    println!("Seed:        {} (32 bytes)", sk_path.display());
}
use ml_dsa::{KeyGen, MlDsa65, signature::Signer};

fn main() {
    let mut rng = rand::rng();
    let kp: ml_dsa::KeyPair<MlDsa65> = MlDsa65::key_gen(&mut rng);

    // 32-byte message matching the contract's bytes32 parameter
    let msg = [0xAB_u8; 32];
    let sig = kp.signing_key().sign(&msg);

    let pk_hex = hex::encode(kp.verifying_key().encode());
    let msg_hex = hex::encode(msg);
    let sig_hex = hex::encode(sig.encode());

    println!("PK_HEX=0x{pk_hex}");
    println!("MSG_HASH=0x{msg_hex}");
    println!("SIG_HEX=0x{sig_hex}");
}
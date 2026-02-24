use std::hint::black_box;
use criterion::{Criterion, criterion_group, criterion_main};

use fips204::ml_dsa_65;
use fips204::traits::{Signer as FipsSigner, Verifier as FipsVerifier};
use ml_dsa::signature::{Signer, Verifier};
use ml_dsa::{KeyGen, MlDsa65};
use rand_chacha::rand_core::SeedableRng;

const MSG: &[u8] = b"benchmark payload";

fn benchmarks(c: &mut Criterion) {
    // -- fips204 setup --
    let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(42);
    let (fips_pk, fips_sk) = ml_dsa_65::try_keygen_with_rng(&mut rng).unwrap();
    let fips_sig = fips_sk.try_sign_with_rng(&mut rng, MSG, &[]).unwrap();

    c.bench_function("fips204_sign", |b| {
        b.iter(|| fips_sk.try_sign_with_rng(&mut rng, black_box(MSG), black_box(&[])).unwrap());
    });

    c.bench_function("fips204_verify", |b| {
        b.iter(|| fips_pk.verify(black_box(MSG), black_box(&fips_sig), black_box(&[])));
    });

    // -- ml-dsa (RustCrypto) setup --
    let mut rc_rng = rand::rng();
    let kp: ml_dsa::KeyPair<MlDsa65> = MlDsa65::key_gen(&mut rc_rng);
    let rc_sig = kp.signing_key().sign(MSG);

    c.bench_function("ml_dsa_sign", |b| {
        b.iter(|| kp.signing_key().sign(black_box(MSG)));
    });

    c.bench_function("ml_dsa_verify", |b| {
        b.iter(|| kp.verifying_key().verify(black_box(MSG), black_box(&rc_sig)).unwrap());
    });
}

criterion_group!(benches, benchmarks);
criterion_main!(benches);

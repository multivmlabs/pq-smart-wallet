#[cfg(test)]
mod tests {
    use fips204::ml_dsa_65;
    use fips204::traits::{SerDes, Signer as FipsSigner, Verifier as FipsVerifier};
    use ml_dsa::signature::{Signer, Verifier};
    use ml_dsa::{KeyGen, MlDsa65};
    use rand_chacha::rand_core::SeedableRng;

    const MSG: &str = "Hello!";

    #[test]
    fn fips204_keygen_sign_verify() {
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(123);
        let (pk1, sk) = ml_dsa_65::try_keygen_with_rng(&mut rng).unwrap();
        let sig = sk.try_sign_with_rng(&mut rng, MSG.as_bytes(), &[]);
        let (pk_send, msg_send, sig_send) = (pk1.into_bytes(), MSG, sig);
        let (pk_recv, msg_recv, sig_recv) = (pk_send, msg_send, sig_send);
        let pk2 = ml_dsa_65::PublicKey::try_from_bytes(pk_recv).unwrap();
        let v = pk2.verify(msg_recv.as_bytes(), &sig_recv.unwrap(), &[]); // Use the public to verify message signature
        assert!(v);
    }

    #[test]
    fn ml_dsa_keygen_sign_verify() {
        let mut rng = rand::rng();
        let kp: ml_dsa::KeyPair<MlDsa65> = MlDsa65::key_gen(&mut rng);
        let sig = kp.signing_key().sign(MSG.as_bytes());
        assert!(kp.verifying_key().verify(MSG.as_bytes(), &sig).is_ok());
    }

    #[test]
    fn ml_dsa_verify_with_public_key_only() {
        let mut rng = rand::rng();
        let kp: ml_dsa::KeyPair<MlDsa65> = MlDsa65::key_gen(&mut rng);
        let sig = kp.signing_key().sign(MSG.as_bytes());

        // Simulate a third party: serialize the public key, then reconstruct from bytes only
        let pk_encoded = kp.verifying_key().encode();
        let pk_standalone = ml_dsa::VerifyingKey::<MlDsa65>::decode(&pk_encoded);
        assert!(pk_standalone.verify(MSG.as_bytes(), &sig).is_ok());
    }
}

#[cfg(test)]
mod acvp_tests {
    use fips204::ml_dsa_65;
    use fips204::traits::{KeyGen, SerDes, Verifier as FipsVerifier};
    use serde::Deserialize;

    // --- ACVP keyGen JSON deserialization structs ---

    #[derive(Deserialize)]
    struct AcvpKeyGenFile {
        #[serde(rename = "testGroups")]
        test_groups: Vec<KeyGenGroup>,
    }

    #[derive(Deserialize)]
    struct KeyGenGroup {
        #[serde(rename = "parameterSet")]
        parameter_set: String,
        tests: Vec<KeyGenTest>,
    }

    #[derive(Deserialize)]
    struct KeyGenTest {
        #[serde(rename = "tcId")]
        tc_id: u32,
        seed: String,
        pk: String,
        sk: String,
    }

    // --- ACVP sigVer JSON deserialization structs ---

    #[derive(Deserialize)]
    struct AcvpSigVerFile {
        #[serde(rename = "testGroups")]
        test_groups: Vec<SigVerGroup>,
    }

    #[derive(Deserialize)]
    struct SigVerGroup {
        #[serde(rename = "tgId")]
        tg_id: u32,
        #[serde(rename = "parameterSet")]
        parameter_set: String,
        #[serde(rename = "signatureInterface")]
        signature_interface: String,
        #[serde(rename = "preHash")]
        pre_hash: String,
        tests: Vec<SigVerTest>,
    }

    #[derive(Deserialize)]
    struct SigVerTest {
        #[serde(rename = "tcId")]
        tc_id: u32,
        #[serde(rename = "testPassed")]
        test_passed: bool,
        pk: String,
        message: Option<String>,
        context: Option<String>,
        signature: String,
        reason: Option<String>,
    }

    #[test]
    fn acvp_sigver_ml_dsa_65() {
        let data = std::fs::read_to_string("test-vectors/sigVer.json")
            .expect("Failed to read sigVer.json — run tests from ml-dsa-test/ crate root");
        let file: AcvpSigVerFile =
            serde_json::from_str(&data).expect("Failed to parse sigVer.json");

        let groups: Vec<&SigVerGroup> = file
            .test_groups
            .iter()
            .filter(|g| {
                g.parameter_set == "ML-DSA-65"
                    && g.signature_interface == "external"
                    && g.pre_hash == "pure"
            })
            .collect();

        assert!(
            !groups.is_empty(),
            "No ML-DSA-65 external groups found in sigVer.json"
        );

        let mut total = 0u32;
        let mut mismatches = 0u32;

        for group in &groups {
            for tc in &group.tests {
                let pk_bytes: Vec<u8> = hex::decode(&tc.pk).expect("bad pk hex");
                let msg = hex::decode(tc.message.as_deref().unwrap_or("")).expect("bad msg hex");
                let ctx = hex::decode(tc.context.as_deref().unwrap_or("")).expect("bad ctx hex");
                let sig_bytes: Vec<u8> = hex::decode(&tc.signature).expect("bad sig hex");

                // Attempt pk construction + verify; any malformed input ⇒ false
                let result = (|| {
                    let pk_arr: [u8; 1952] = pk_bytes.try_into().ok()?;
                    let sig_arr: [u8; 3309] = sig_bytes.try_into().ok()?;
                    let pk = ml_dsa_65::PublicKey::try_from_bytes(pk_arr).ok()?;
                    Some(pk.verify(&msg, &sig_arr, &ctx))
                })()
                .unwrap_or(false);

                total += 1;
                if result != tc.test_passed {
                    eprintln!(
                        "MISMATCH tgId={} tcId={}: expected={}, got={}, reason={:?}",
                        group.tg_id, tc.tc_id, tc.test_passed, result, tc.reason
                    );
                    mismatches += 1;
                }
            }
        }

        println!("ACVP sigVer ML-DSA-65 external: {total} vectors tested, {mismatches} mismatches");
        assert_eq!(
            mismatches, 0,
            "ACVP sigVer: {mismatches}/{total} test vectors did not match expected results"
        );
    }

    #[test]
    fn acvp_keygen_ml_dsa_65() {
        let data = std::fs::read_to_string("test-vectors/keyGen.json")
            .expect("Failed to read keyGen.json — run tests from ml-dsa-test/ crate root");
        let file: AcvpKeyGenFile =
            serde_json::from_str(&data).expect("Failed to parse keyGen.json");

        let groups: Vec<&KeyGenGroup> = file
            .test_groups
            .iter()
            .filter(|g| g.parameter_set == "ML-DSA-65")
            .collect();

        assert!(
            !groups.is_empty(),
            "No ML-DSA-65 groups found in keyGen.json"
        );

        let mut total = 0u32;
        let mut mismatches = 0u32;

        for group in &groups {
            for tc in &group.tests {
                let seed_bytes: [u8; 32] = hex::decode(&tc.seed)
                    .expect("bad seed hex")
                    .try_into()
                    .expect("seed not 32 bytes");
                let expected_pk = hex::decode(&tc.pk).expect("bad pk hex");
                let expected_sk = hex::decode(&tc.sk).expect("bad sk hex");

                let (pk, sk) = ml_dsa_65::KG::keygen_from_seed(&seed_bytes);

                let pk_match = pk.into_bytes() == *expected_pk;
                let sk_match = sk.into_bytes() == *expected_sk;

                total += 1;
                if !pk_match || !sk_match {
                    eprintln!(
                        "MISMATCH tcId={}: pk_match={pk_match}, sk_match={sk_match}",
                        tc.tc_id
                    );
                    mismatches += 1;
                }
            }
        }

        println!("ACVP keyGen ML-DSA-65: {total} vectors tested, {mismatches} mismatches");
        assert_eq!(
            mismatches, 0,
            "ACVP keyGen: {mismatches}/{total} test vectors did not match expected results"
        );
    }
}

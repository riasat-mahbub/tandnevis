//! Validation for the OpenAI OIDC ID token used by the direct OSS flow.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::time::{SystemTime, UNIX_EPOCH};

const OIDC_ISSUER: &str = "https://auth.openai.com";

#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Debug, Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    alg: Option<String>,
    #[serde(rename = "use")]
    key_use: Option<String>,
    key_ops: Option<Vec<String>>,
    n: String,
    e: String,
}

#[derive(Debug, Deserialize)]
struct Header {
    alg: String,
    kid: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(untagged)]
enum Audience {
    Single(String),
    Multiple(Vec<String>),
}

impl Audience {
    fn includes(&self, expected: &str) -> bool {
        match self {
            Self::Single(value) => value == expected,
            Self::Multiple(values) => values.iter().any(|value| value == expected),
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Claims {
    pub iss: String,
    aud: Audience,
    azp: Option<String>,
    pub exp: u64,
    nbf: Option<u64>,
    nonce: String,
    pub sub: String,
    pub email: Option<String>,
    #[serde(default)]
    pub email_verified: Option<bool>,
    pub name: Option<String>,
    pub preferred_username: Option<String>,
}

fn decode_part<T: serde::de::DeserializeOwned>(segment: &str) -> Result<T, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(segment)
        .map_err(|_| "ChatGPT returned an invalid identity token.".to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "ChatGPT returned an invalid identity token.".to_string())
}

pub fn verify(
    token: &str,
    client_id: &str,
    expected_nonce: &str,
    jwks_json: &[u8],
) -> Result<Claims, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock is not available.".to_string())?
        .as_secs();
    verify_at(token, client_id, expected_nonce, jwks_json, now)
}

fn verify_at(
    token: &str,
    client_id: &str,
    expected_nonce: &str,
    jwks_json: &[u8],
    now: u64,
) -> Result<Claims, String> {
    let mut parts = token.split('.');
    let (Some(header_part), Some(claims_part), Some(signature_part), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err("ChatGPT returned an invalid identity token.".into());
    };
    let header: Header = decode_part(header_part)?;
    if header.alg != "RS256" || header.kid.is_empty() {
        return Err("ChatGPT used an unsupported identity-token signature.".into());
    }
    let claims: Claims = decode_part(claims_part)?;
    validate_claims(&claims, client_id, expected_nonce, now)?;
    let jwks: Jwks = serde_json::from_slice(jwks_json)
        .map_err(|_| "ChatGPT signing keys could not be read.".to_string())?;
    let jwk = jwks
        .keys
        .iter()
        .find(|key| {
            key.kid == header.kid
                && key.kty == "RSA"
                && key.alg.as_deref().is_none_or(|alg| alg == "RS256")
                && key.key_use.as_deref().is_none_or(|usage| usage == "sig")
                && key
                    .key_ops
                    .as_ref()
                    .is_none_or(|ops| ops.iter().any(|operation| operation == "verify"))
        })
        .ok_or_else(|| "ChatGPT identity signature could not be verified.".to_string())?;
    let signing_input = format!("{header_part}.{claims_part}");
    let digest = sha2::Sha256::digest(signing_input.as_bytes());
    let signature = URL_SAFE_NO_PAD
        .decode(signature_part)
        .map_err(|_| "ChatGPT returned an invalid identity signature.".to_string())?;
    verify_rs256(&jwk.n, &jwk.e, &digest, &signature)?;
    Ok(claims)
}

fn validate_claims(
    claims: &Claims,
    client_id: &str,
    expected_nonce: &str,
    now: u64,
) -> Result<(), String> {
    let multiple_audiences = matches!(&claims.aud, Audience::Multiple(values) if values.len() > 1);
    if claims.iss != OIDC_ISSUER
        || !claims.aud.includes(client_id)
        || (multiple_audiences && claims.azp.as_deref() != Some(client_id))
        || claims.azp.as_deref().is_some_and(|azp| azp != client_id)
        || claims.exp <= now
        || claims.nbf.is_some_and(|not_before| not_before > now)
        || claims.nonce != expected_nonce
        || claims.sub.trim().is_empty()
    {
        return Err("ChatGPT identity validation failed. Try signing in again.".into());
    }
    Ok(())
}

#[cfg(windows)]
fn verify_rs256(
    modulus: &str,
    exponent: &str,
    digest: &[u8],
    signature: &[u8],
) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::NTSTATUS,
            Security::Cryptography::{
                BCryptCloseAlgorithmProvider, BCryptDestroyKey, BCryptImportKeyPair,
                BCryptOpenAlgorithmProvider, BCryptVerifySignature, BCRYPT_ALG_HANDLE,
                BCRYPT_KEY_HANDLE, BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS, BCRYPT_PAD_PKCS1,
                BCRYPT_PKCS1_PADDING_INFO, BCRYPT_RSAKEY_BLOB, BCRYPT_RSAPUBLIC_BLOB,
                BCRYPT_RSAPUBLIC_MAGIC, BCRYPT_RSA_ALGORITHM, BCRYPT_SHA256_ALGORITHM,
            },
        },
    };

    fn ok(status: NTSTATUS) -> bool {
        status.0 >= 0
    }
    let modulus = URL_SAFE_NO_PAD
        .decode(modulus)
        .map_err(|_| "ChatGPT signing key is invalid.".to_string())?;
    let exponent = URL_SAFE_NO_PAD
        .decode(exponent)
        .map_err(|_| "ChatGPT signing key is invalid.".to_string())?;
    if modulus.is_empty() || modulus.len() > 1024 || exponent.is_empty() || exponent.len() > 8 {
        return Err("ChatGPT signing key has an unsupported size.".into());
    }
    let bit_length = ((modulus.len() - 1) * 8 + (8 - modulus[0].leading_zeros() as usize)) as u32;
    let blob_header = BCRYPT_RSAKEY_BLOB {
        Magic: BCRYPT_RSAPUBLIC_MAGIC,
        BitLength: bit_length,
        cbPublicExp: exponent.len() as u32,
        cbModulus: modulus.len() as u32,
        cbPrime1: 0,
        cbPrime2: 0,
    };
    let header = unsafe {
        std::slice::from_raw_parts(
            (&blob_header as *const BCRYPT_RSAKEY_BLOB).cast::<u8>(),
            std::mem::size_of::<BCRYPT_RSAKEY_BLOB>(),
        )
    };
    let mut blob = Vec::with_capacity(header.len() + exponent.len() + modulus.len());
    blob.extend_from_slice(header);
    blob.extend_from_slice(&exponent);
    blob.extend_from_slice(&modulus);

    let mut algorithm: BCRYPT_ALG_HANDLE = unsafe { std::mem::zeroed() };
    let opened = unsafe {
        BCryptOpenAlgorithmProvider(
            &mut algorithm,
            BCRYPT_RSA_ALGORITHM,
            PCWSTR::null(),
            BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS(0),
        )
    };
    if !ok(opened) {
        return Err("Windows could not verify the ChatGPT identity signature.".into());
    }
    let mut key: BCRYPT_KEY_HANDLE = unsafe { std::mem::zeroed() };
    let imported =
        unsafe { BCryptImportKeyPair(algorithm, None, BCRYPT_RSAPUBLIC_BLOB, &mut key, &blob, 0) };
    if !ok(imported) {
        unsafe {
            let _ = BCryptCloseAlgorithmProvider(algorithm, 0);
        }
        return Err("ChatGPT identity signature could not be verified.".into());
    }
    let padding = BCRYPT_PKCS1_PADDING_INFO {
        pszAlgId: BCRYPT_SHA256_ALGORITHM,
    };
    let verified = unsafe {
        BCryptVerifySignature(
            key,
            Some((&padding as *const BCRYPT_PKCS1_PADDING_INFO).cast()),
            digest,
            signature,
            BCRYPT_PAD_PKCS1,
        )
    };
    unsafe {
        let _ = BCryptDestroyKey(key);
        let _ = BCryptCloseAlgorithmProvider(algorithm, 0);
    }
    if ok(verified) {
        Ok(())
    } else {
        Err("ChatGPT identity signature could not be verified.".into())
    }
}

#[cfg(not(windows))]
fn verify_rs256(
    _modulus: &str,
    _exponent: &str,
    _digest: &[u8],
    _signature: &[u8],
) -> Result<(), String> {
    Err("ChatGPT sign-in is currently supported in the Windows desktop app.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_claims() -> Claims {
        Claims {
            iss: OIDC_ISSUER.into(),
            aud: Audience::Single("oaiapp-test".into()),
            azp: None,
            exp: 2_000,
            nbf: Some(900),
            nonce: "nonce-1".into(),
            sub: "subject-1".into(),
            email: None,
            email_verified: None,
            name: None,
            preferred_username: None,
        }
    }

    fn token(claims: &Claims, signature: &[u8]) -> String {
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256","kid":"test-key"}"#);
        let claims = URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).unwrap());
        format!("{header}.{claims}.{}", URL_SAFE_NO_PAD.encode(signature))
    }

    fn jwks() -> Vec<u8> {
        // An odd 2048-bit RSA public modulus is sufficient to exercise CNG's
        // rejection of an invalid signature; no network or account is involved.
        let modulus = URL_SAFE_NO_PAD.encode([0xff; 256]);
        let exponent = URL_SAFE_NO_PAD.encode([1, 0, 1]);
        serde_json::to_vec(&serde_json::json!({
            "keys": [{ "kid": "test-key", "kty": "RSA", "alg": "RS256", "n": modulus, "e": exponent }]
        })).unwrap()
    }

    #[test]
    fn rejects_bad_nonce() {
        let mut claims = valid_claims();
        claims.nonce = "other".into();
        assert!(validate_claims(&claims, "oaiapp-test", "nonce-1", 1_000).is_err());
    }

    #[test]
    fn rejects_bad_audience() {
        let mut claims = valid_claims();
        claims.aud = Audience::Single("other-client".into());
        assert!(validate_claims(&claims, "oaiapp-test", "nonce-1", 1_000).is_err());
    }

    #[test]
    fn requires_authorized_party_for_multiple_audiences() {
        let mut claims = valid_claims();
        claims.aud = Audience::Multiple(vec!["oaiapp-test".into(), "another-client".into()]);
        assert!(validate_claims(&claims, "oaiapp-test", "nonce-1", 1_000).is_err());
        claims.azp = Some("oaiapp-test".into());
        assert!(validate_claims(&claims, "oaiapp-test", "nonce-1", 1_000).is_ok());
    }

    #[test]
    fn rejects_wrong_authorized_party() {
        let mut claims = valid_claims();
        claims.azp = Some("other-client".into());
        assert!(validate_claims(&claims, "oaiapp-test", "nonce-1", 1_000).is_err());
    }

    #[test]
    fn rejects_wrong_issuer() {
        let mut claims = valid_claims();
        claims.iss = "https://attacker.example".into();
        assert!(validate_claims(&claims, "oaiapp-test", "nonce-1", 1_000).is_err());
    }

    #[test]
    fn rejects_expired_or_not_yet_valid_tokens() {
        let mut claims = valid_claims();
        claims.exp = 999;
        assert!(validate_claims(&claims, "oaiapp-test", "nonce-1", 1_000).is_err());
        claims.exp = 2_000;
        claims.nbf = Some(1_001);
        assert!(validate_claims(&claims, "oaiapp-test", "nonce-1", 1_000).is_err());
    }

    #[test]
    fn rejects_bad_signature_with_matching_identity_claims() {
        let claims = valid_claims();
        let signed = token(&claims, &[0; 256]);
        assert!(verify_at(&signed, "oaiapp-test", "nonce-1", &jwks(), 1_000).is_err());
    }
}

//! OAuth tokens live in the Windows user credential store, never in project SQLite
//! or the portable settings file.

fn valid_target(slot: &str, name: &str) -> bool {
    if slot == "host" {
        return name == "ext_agent_host_id";
    }
    uuid::Uuid::parse_str(slot).is_ok_and(|value| value.to_string() == slot)
        && matches!(name, "access" | "refresh" | "id")
}

#[cfg(windows)]
mod platform {
    use std::ptr;
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn target(slot: &str, name: &str) -> String {
        format!("com.shorthandwriter.desktop/ChatGPT/{slot}/{name}")
    }

    pub fn write(slot: &str, name: &str, secret: &str) -> Result<(), String> {
        if secret.is_empty() || secret.len() > 2500 {
            return Err("The ChatGPT credential has an invalid size.".into());
        }
        let target_value = target(slot, name);
        let mut target_w = wide(&target_value);
        let mut user_w = wide("Shorthand Writer");
        let mut blob = secret.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR::from_raw(target_w.as_mut_ptr()),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR::from_raw(user_w.as_mut_ptr()),
            ..Default::default()
        };
        let result = unsafe { CredWriteW(&credential, 0) }
            .map_err(|_| "Windows could not protect the ChatGPT credential.".to_string());
        blob.fill(0);
        result
    }

    pub fn read(slot: &str, name: &str) -> Result<Option<String>, String> {
        let target_value = target(slot, name);
        let target_w = wide(&target_value);
        let mut credential = ptr::null_mut();
        let result = unsafe {
            CredReadW(
                PCWSTR::from_raw(target_w.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
                &mut credential,
            )
        };
        if let Err(error) = result {
            // Win32 ERROR_NOT_FOUND (1168) becomes HRESULT_FROM_WIN32(1168).
            if (error.code().0 as u32 & 0xffff) == 1168 {
                return Ok(None);
            }
            return Err("Windows could not access the ChatGPT credential.".into());
        }
        if credential.is_null() {
            return Err("Windows returned an empty ChatGPT credential.".into());
        }
        let raw = unsafe { &*credential };
        let value = if raw.CredentialBlob.is_null() || raw.CredentialBlobSize == 0 {
            Err("Windows returned an empty ChatGPT credential.".to_string())
        } else if raw.CredentialBlobSize > 2500 {
            Err("The stored ChatGPT credential has an invalid size.".to_string())
        } else {
            let bytes = unsafe {
                std::slice::from_raw_parts(raw.CredentialBlob, raw.CredentialBlobSize as usize)
            };
            std::str::from_utf8(bytes)
                .map(str::to_owned)
                .map(Some)
                .map_err(|_| "The stored ChatGPT credential is invalid.".to_string())
        };
        unsafe { CredFree(credential.cast()) };
        value
    }

    pub fn delete(slot: &str, name: &str) -> Result<(), String> {
        let target_value = target(slot, name);
        let target_w = wide(&target_value);
        let result =
            unsafe { CredDeleteW(PCWSTR::from_raw(target_w.as_ptr()), CRED_TYPE_GENERIC, None) };
        match result {
            Ok(()) => Ok(()),
            Err(error) if (error.code().0 as u32 & 0xffff) == 1168 => Ok(()),
            Err(_) => Err("Windows could not remove a ChatGPT credential.".into()),
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn write(_slot: &str, _name: &str, _secret: &str) -> Result<(), String> {
        Err("Protected ChatGPT credentials are supported in the Windows desktop app.".into())
    }
    pub fn read(_slot: &str, _name: &str) -> Result<Option<String>, String> {
        Err("Protected ChatGPT credentials are supported in the Windows desktop app.".into())
    }
    pub fn delete(_slot: &str, _name: &str) -> Result<(), String> {
        Ok(())
    }
}

pub fn write(slot: &str, name: &str, secret: &str) -> Result<(), String> {
    if !valid_target(slot, name) {
        return Err("The ChatGPT credential location is invalid.".into());
    }
    platform::write(slot, name, secret)
}
pub fn read(slot: &str, name: &str) -> Result<Option<String>, String> {
    if !valid_target(slot, name) {
        return Err("The ChatGPT credential location is invalid.".into());
    }
    platform::read(slot, name)
}
pub fn delete(slot: &str, name: &str) -> Result<(), String> {
    if !valid_target(slot, name) {
        return Err("The ChatGPT credential location is invalid.".into());
    }
    platform::delete(slot, name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_names_are_restricted_to_app_owned_slots() {
        assert!(valid_target("host", "ext_agent_host_id"));
        assert!(!valid_target("host", "access"));
        assert!(valid_target(
            "d9428888-122b-4f43-95f5-2c6b7c2d1a02",
            "refresh"
        ));
        assert!(!valid_target("not-a-slot", "refresh"));
        assert!(!valid_target(
            "d9428888-122b-4f43-95f5-2c6b7c2d1a02",
            "password"
        ));
    }
}

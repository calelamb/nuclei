//! Where the Anthropic API key is persisted.
//!
//! [`KeyringStore`] is the real implementation (OS keychain, via the
//! `keyring` crate); [`MemoryStore`] is an in-memory stand-in for tests that
//! never touches the OS keychain.

use std::sync::RwLock;

use super::GatewayError;

/// Keychain service name for the stored Anthropic API key.
const DEFAULT_SERVICE: &str = "dev.getnuclei.dirac";
/// Keychain account name for the stored Anthropic API key.
const DEFAULT_ACCOUNT: &str = "anthropic-api-key";

/// Where the Anthropic API key is persisted. The real implementation
/// ([`KeyringStore`]) uses the OS keychain; [`MemoryStore`] is for tests.
pub trait SecretStore: Send + Sync {
    fn store(&self, secret: &str) -> Result<(), GatewayError>;
    fn load(&self) -> Result<Option<String>, GatewayError>;
    fn clear(&self) -> Result<(), GatewayError>;
}

/// OS-keychain-backed secret store: macOS Keychain, Windows Credential
/// Manager, or (headless) Linux Secret Service, via the `keyring` crate.
pub struct KeyringStore {
    service: String,
    account: String,
}

impl KeyringStore {
    pub fn new(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, GatewayError> {
        keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| GatewayError::Store(e.to_string()))
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new(DEFAULT_SERVICE, DEFAULT_ACCOUNT)
    }
}

impl SecretStore for KeyringStore {
    fn store(&self, secret: &str) -> Result<(), GatewayError> {
        self.entry()?
            .set_password(secret)
            .map_err(|e| GatewayError::Store(e.to_string()))
    }

    fn load(&self) -> Result<Option<String>, GatewayError> {
        match self.entry()?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(GatewayError::Store(e.to_string())),
        }
    }

    fn clear(&self) -> Result<(), GatewayError> {
        match self.entry()?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(GatewayError::Store(e.to_string())),
        }
    }
}

/// In-memory secret store for tests. Never touches the OS keychain.
#[derive(Default)]
pub struct MemoryStore(RwLock<Option<String>>);

impl SecretStore for MemoryStore {
    fn store(&self, secret: &str) -> Result<(), GatewayError> {
        let mut guard = self
            .0
            .write()
            .map_err(|_| GatewayError::Store("memory store lock poisoned".to_string()))?;
        *guard = Some(secret.to_string());
        Ok(())
    }

    fn load(&self) -> Result<Option<String>, GatewayError> {
        let guard = self
            .0
            .read()
            .map_err(|_| GatewayError::Store("memory store lock poisoned".to_string()))?;
        Ok(guard.clone())
    }

    fn clear(&self) -> Result<(), GatewayError> {
        let mut guard = self
            .0
            .write()
            .map_err(|_| GatewayError::Store("memory store lock poisoned".to_string()))?;
        *guard = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trips_and_clears() {
        let store = MemoryStore::default();
        assert_eq!(store.load().expect("load"), None);

        store.store("sk-ant-test-key").expect("store");
        assert_eq!(
            store.load().expect("load"),
            Some("sk-ant-test-key".to_string())
        );

        store.clear().expect("clear");
        assert_eq!(store.load().expect("load"), None);
    }
}

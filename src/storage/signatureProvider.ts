import { ApiInterfaces, JsSignatureProvider, Key } from '@proton/js'
import { config } from './config'
import { getKey as getKeychainKey, isKeychainSupported } from './keychain'
import { authenticate as touchIdAuthenticate, isTouchIdAvailable } from './touchId'
import passwordManager from './passwordManager'

const canonicalize = (k: string): string => Key.PublicKey.fromString(k).toString()

export async function buildSignatureProvider(): Promise<ApiInterfaces.SignatureProvider> {
  const configPrivateKeys = await passwordManager.getPrivateKeys()
  const keychainPublicKeys = isKeychainSupported()
    ? ((config.get('keychainPublicKeys') ?? []) as string[])
    : []

  const configPublicKeys = configPrivateKeys.map(
    pk => Key.PrivateKey.fromString(pk).getPublicKey().toString()
  )

  return {
    async getAvailableKeys() {
      return [...configPublicKeys, ...keychainPublicKeys]
    },
    async sign(args: ApiInterfaces.SignatureProviderArgs) {
      const requiredCanonical = args.requiredKeys.map(canonicalize)

      const keychainNeeded = keychainPublicKeys.filter(pk =>
        requiredCanonical.includes(canonicalize(pk))
      )

      const fetchedKeychainPrivateKeys: string[] = []
      if (keychainNeeded.length > 0) {
        if (isTouchIdAvailable()) {
          const reason = keychainNeeded.length === 1
            ? `Sign Proton transaction with ${keychainNeeded[0].slice(0, 24)}…`
            : `Sign Proton transaction with ${keychainNeeded.length} Keychain-stored keys`
          const ok = touchIdAuthenticate(reason)
          if (!ok) {
            throw new Error('Touch ID authentication failed or was cancelled.')
          }
        }
        for (const pub of keychainNeeded) {
          const priv = getKeychainKey(pub)
          if (priv) fetchedKeychainPrivateKeys.push(priv)
        }
      }

      const inner = new JsSignatureProvider([
        ...configPrivateKeys,
        ...fetchedKeychainPrivateKeys,
      ])
      return inner.sign(args)
    },
  }
}

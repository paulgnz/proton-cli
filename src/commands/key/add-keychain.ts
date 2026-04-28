import { Command } from '@oclif/command'
import { CliUx } from '@oclif/core'
import { Key, Numeric } from '@proton/js'
import { green, red, yellow } from 'colors'
import { addKey, hasKey, isKeychainSupported } from '../../storage/keychain'
import { config } from '../../storage/config'

export default class KeyAddKeychain extends Command {
  static description = 'Add a private key to the macOS Keychain instead of the default config storage'

  static args = [
    { name: 'privateKey', required: false },
  ]

  async run() {
    if (!isKeychainSupported()) {
      CliUx.ux.error('Keychain storage is currently only supported on macOS.')
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      CliUx.ux.error('This command must be run in an interactive terminal.')
    }

    const { args } = this.parse(KeyAddKeychain)
    let privateKeyStr: string | undefined = args.privateKey

    if (!privateKeyStr) {
      const generate = await CliUx.ux.confirm('No key provided. Generate a new keypair? (yes/no)')
      if (generate) {
        const generated = Key.generateKeyPair(Numeric.KeyType.k1, { secureEnv: true })
        privateKeyStr = generated.privateKey.toString()
        CliUx.ux.log(green(`Generated new keypair. Public key: ${generated.publicKey.toString()}`))
      } else {
        privateKeyStr = await CliUx.ux.prompt('Enter private key (PVT_K1_...)', { type: 'hide' })
      }
    }

    let privateKey: Key.PrivateKey
    try {
      privateKey = Key.PrivateKey.fromString(privateKeyStr!)
    } catch (e) {
      CliUx.ux.error(`Invalid private key: ${(e as Error).message}`)
      return
    }
    const publicKey = privateKey.getPublicKey().toString()

    if (hasKey(publicKey)) {
      const overwrite = await CliUx.ux.confirm(`A Keychain entry for ${publicKey} already exists. Overwrite? (yes/no)`)
      if (!overwrite) {
        CliUx.ux.log('Cancelled.')
        return
      }
    }

    try {
      addKey(publicKey, privateKey.toString())
    } catch (e) {
      CliUx.ux.error(`Failed to store key in Keychain: ${(e as Error).message}`)
      return
    }

    const index = (config.get('keychainPublicKeys') ?? []) as string[]
    if (!index.includes(publicKey)) {
      index.push(publicKey)
      config.set('keychainPublicKeys', index)
    }

    CliUx.ux.log(green(`Success: stored private key in macOS Keychain.`))
    CliUx.ux.log(`Public key: ${publicKey}`)
    CliUx.ux.log(yellow('macOS may prompt for permission the first time another tool reads this entry. The key never enters the regular config file.'))
  }

  async catch(e: Error) {
    CliUx.ux.error(red(e.message))
  }
}

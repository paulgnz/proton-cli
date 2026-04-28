import { Command, flags } from '@oclif/command'
import { CliUx } from '@oclif/core'
import { Key, Numeric } from '@proton/js'
import { green, red, yellow } from 'colors'
import { network } from '../../storage/networks'
import { addKey as addKeychainKey, hasKey as hasKeychainKey, isKeychainSupported } from '../../storage/keychain'
import { config } from '../../storage/config'
import { sortRequiredAuth } from '../../utils/sortRequiredAuth'

export default class AccountAddKey extends Command {
  static description = 'Generate a new keypair, store the private key in the macOS Keychain, and add the public key to one of the account\'s permissions on-chain'

  static args = [
    { name: 'account', required: true, description: 'Account whose permission you are extending' },
  ]

  static flags = {
    permission: flags.string({
      char: 'p',
      description: 'Permission to add the new key to',
      default: 'active',
    }),
    weight: flags.integer({
      char: 'w',
      description: 'Weight to assign the new key in the permission',
      default: 1,
    }),
    'signing-permission': flags.string({
      char: 's',
      description: 'Permission used to sign the updateauth transaction (defaults to account@<permission> or @owner if updating owner)',
    }),
    'dry-run': flags.boolean({
      description: 'Print the unsigned action without broadcasting',
      default: false,
    }),
  }

  async run() {
    if (!isKeychainSupported()) {
      CliUx.ux.error('Keychain storage is currently only supported on macOS.')
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      CliUx.ux.error('This command must be run in an interactive terminal.')
    }

    const { args, flags: parsedFlags } = this.parse(AccountAddKey)
    const account = args.account
    const permissionName = parsedFlags.permission
    const weight = parsedFlags.weight
    const dryRun = parsedFlags['dry-run']

    const accountInfo = await network.rpc.get_account(account)
    const targetPerm = accountInfo.permissions.find(p => p.perm_name === permissionName)
    if (!targetPerm) {
      CliUx.ux.error(`Account ${account} has no permission named "${permissionName}". Existing permissions: ${accountInfo.permissions.map(p => p.perm_name).join(', ')}`)
      return
    }

    // Generate new keypair
    const generated = Key.generateKeyPair(Numeric.KeyType.k1, { secureEnv: true })
    const newPublicKey = generated.publicKey.toString()
    const newPrivateKey = generated.privateKey.toString()
    CliUx.ux.log(`Generated new keypair. Public key: ${green(newPublicKey)}`)

    // Build updated auth
    const updatedKeys = [
      ...targetPerm.required_auth.keys.map(k => ({
        key: Key.PublicKey.fromString(k.key).toString(),
        weight: k.weight,
      })),
      { key: newPublicKey, weight },
    ]
    const updatedAuth = {
      threshold: targetPerm.required_auth.threshold,
      keys: updatedKeys,
      accounts: targetPerm.required_auth.accounts,
      waits: targetPerm.required_auth.waits,
    }
    sortRequiredAuth(updatedAuth)

    const signingPermission = parsedFlags['signing-permission']
      ?? (permissionName === 'owner' ? `${account}@owner` : `${account}@${permissionName}`)
    const [signerActor, signerPerm] = signingPermission.split('@')
    if (!signerActor || !signerPerm) {
      CliUx.ux.error(`Invalid --signing-permission "${signingPermission}". Expected format: account@permission`)
      return
    }

    const action = {
      account: 'eosio',
      name: 'updateauth',
      data: {
        account,
        permission: permissionName,
        parent: targetPerm.parent,
        auth: updatedAuth,
      },
      authorization: [{ actor: signerActor, permission: signerPerm }],
    }

    CliUx.ux.log(yellow('\nUpdate to be applied:'))
    CliUx.ux.styledJSON(action.data)
    CliUx.ux.log('')

    if (dryRun) {
      CliUx.ux.log(yellow('Dry run — transaction not broadcast. Re-run without --dry-run to apply.'))
      CliUx.ux.log(yellow('Private key was NOT stored in Keychain because the on-chain change did not happen.'))
      return
    }

    const proceed = await CliUx.ux.confirm(`Add this key to ${account}@${permissionName} (signed by ${signingPermission})? (yes/no)`)
    if (!proceed) {
      CliUx.ux.log('Cancelled.')
      return
    }

    // Store in keychain BEFORE broadcasting — if broadcast fails we can clean up; if it succeeds
    // we must not lose the key
    if (hasKeychainKey(newPublicKey)) {
      CliUx.ux.error(`Keychain already has an entry for ${newPublicKey}. Aborting before broadcast.`)
      return
    }
    addKeychainKey(newPublicKey, newPrivateKey)
    const idx = (config.get('keychainPublicKeys') ?? []) as string[]
    if (!idx.includes(newPublicKey)) {
      idx.push(newPublicKey)
      config.set('keychainPublicKeys', idx)
    }

    try {
      const result: any = await network.transact({ actions: [action] })
      CliUx.ux.log(`${green('Success:')} new key added to ${account}@${permissionName}.`)
      if (result?.transaction_id) {
        CliUx.ux.log(`Transaction: ${result.transaction_id}`)
      }
      CliUx.ux.log(green('Private key is in macOS Keychain. Future signing for this key will use Touch ID (if available).'))
    } catch (e) {
      CliUx.ux.log(red(`updateauth failed: ${(e as Error).message}`))
      CliUx.ux.log(yellow('The private key was already saved to Keychain. To clean up: proton key:list, find the new entry, and remove it via Keychain Access if you want.'))
      throw e
    }
  }

  async catch(e: Error) {
    CliUx.ux.error(red(e.message))
  }
}

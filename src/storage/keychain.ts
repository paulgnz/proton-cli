import { execFileSync } from 'child_process'

const SERVICE = 'proton-cli'

export function isKeychainSupported(): boolean {
  return process.platform === 'darwin'
}

export function addKey(publicKey: string, privateKey: string): void {
  if (!isKeychainSupported()) {
    throw new Error('macOS Keychain storage is only supported on darwin')
  }
  execFileSync(
    'security',
    [
      'add-generic-password',
      '-U',
      '-s', SERVICE,
      '-a', publicKey,
      '-w', privateKey,
      '-D', 'Proton CLI private key',
      '-l', `Proton CLI key (${publicKey.slice(0, 20)}…)`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
}

export function getKey(publicKey: string): string | null {
  if (!isKeychainSupported()) return null
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', SERVICE, '-a', publicKey, '-w'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return out.toString().trim()
  } catch {
    return null
  }
}

export function deleteKey(publicKey: string): boolean {
  if (!isKeychainSupported()) return false
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', SERVICE, '-a', publicKey],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    return true
  } catch {
    return false
  }
}

export function hasKey(publicKey: string): boolean {
  if (!isKeychainSupported()) return false
  try {
    execFileSync(
      'security',
      ['find-generic-password', '-s', SERVICE, '-a', publicKey],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    return true
  } catch {
    return false
  }
}

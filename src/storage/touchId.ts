import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, statSync } from 'fs'
import * as path from 'path'

const SWIFT_SOURCE_FILENAME = 'bio_auth.swift'
const COMPILED_BINARY_FILENAME = 'bio_auth'

let cachedBinaryPath: string | null = null

function findSwiftSource(): string | null {
  const candidates = [
    // After tsc build, this file lives at lib/storage/touchId.js, source is at lib/native/...
    path.resolve(__dirname, '..', 'native', SWIFT_SOURCE_FILENAME),
    // Dev mode: source at src/native/...
    path.resolve(__dirname, '..', '..', 'src', 'native', SWIFT_SOURCE_FILENAME),
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

function ensureCompiled(): string | null {
  if (process.platform !== 'darwin') return null
  if (cachedBinaryPath && existsSync(cachedBinaryPath)) return cachedBinaryPath

  const swiftSource = findSwiftSource()
  if (!swiftSource) return null

  const binDir = path.dirname(swiftSource)
  const binPath = path.join(binDir, COMPILED_BINARY_FILENAME)

  // Recompile if missing or older than source
  let needsCompile = !existsSync(binPath)
  if (!needsCompile) {
    try {
      const srcMtime = statSync(swiftSource).mtimeMs
      const binMtime = statSync(binPath).mtimeMs
      needsCompile = binMtime < srcMtime
    } catch {
      needsCompile = true
    }
  }

  if (needsCompile) {
    try {
      mkdirSync(binDir, { recursive: true })
      execFileSync('swiftc', ['-O', '-o', binPath, swiftSource], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch {
      return null
    }
  }

  cachedBinaryPath = binPath
  return binPath
}

export function isTouchIdAvailable(): boolean {
  return ensureCompiled() !== null
}

/**
 * Triggers a Touch ID prompt with the given reason. Returns true on success,
 * false on cancel/failure/unavailable. Never throws.
 */
export function authenticate(reason: string): boolean {
  const bin = ensureCompiled()
  if (!bin) return false
  const result = spawnSync(bin, [reason], { stdio: ['ignore', 'ignore', 'pipe'] })
  return result.status === 0
}

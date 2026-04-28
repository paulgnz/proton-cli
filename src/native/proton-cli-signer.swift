import Foundation
import LocalAuthentication

let reason = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "Authorize Proton CLI to access a private key"

let context = LAContext()
context.localizedFallbackTitle = ""

var error: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
    FileHandle.standardError.write("biometrics-unavailable: \(error?.localizedDescription ?? "unknown")\n".data(using: .utf8)!)
    exit(2)
}

let semaphore = DispatchSemaphore(value: 0)
var success = false
var failureMessage = ""

context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, evalError in
    success = ok
    if !ok, let evalError = evalError {
        failureMessage = evalError.localizedDescription
    }
    semaphore.signal()
}
semaphore.wait()

if success {
    exit(0)
}

FileHandle.standardError.write("auth-failed: \(failureMessage)\n".data(using: .utf8)!)
exit(1)

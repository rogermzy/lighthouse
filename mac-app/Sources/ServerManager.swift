import Foundation

/// Owns the Node child process running the Lighthouse backend. Handles
/// startup, detecting "already running" state, polling for readiness, and
/// clean shutdown. All work is off the main thread; completion fires back
/// asynchronously.
class ServerManager {
    private var process: Process?
    private let serverURL = URL(string: "http://127.0.0.1:7373/api/meta")!
    private(set) var lastError: String?

    /// Path the user wants Lighthouse to run from. Defaults to ~/claude/adhd/backend
    /// but can be overridden via:
    ///   defaults write com.rogermzy.lighthouse LighthouseBackendPath /path/to/backend
    private var backendPath: String {
        if let custom = UserDefaults.standard.string(forKey: "LighthouseBackendPath") {
            return custom
        }
        return NSString(string: "~/claude/adhd/backend").expandingTildeInPath
    }

    func start(completion: @escaping (Bool) -> Void) {
        // If something is already listening on :7373 (likely the user already
        // ran `npm start` in a terminal), reuse it rather than fighting for
        // the port. The app's job is to put a window on the server, not to
        // own it exclusively.
        checkServerAlive { [weak self] alive in
            if alive {
                NSLog("[Lighthouse] server already running on :7373 — reusing")
                completion(true)
                return
            }
            self?.spawnServer(completion: completion)
        }
    }

    func stop() {
        process?.terminate()
        process = nil
    }

    // MARK: - Private

    private func checkServerAlive(completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: serverURL)
        request.timeoutInterval = 1.0
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let alive = (response as? HTTPURLResponse)?.statusCode == 200
            completion(alive)
        }.resume()
    }

    private func spawnServer(completion: @escaping (Bool) -> Void) {
        let path = backendPath
        guard FileManager.default.fileExists(atPath: path) else {
            lastError = "Backend folder not found at \(path)."
            completion(false)
            return
        }

        // GUI Mac apps don't inherit the user's login-shell $PATH, so we
        // probe a short list of common install locations. Adjust the nvm
        // glob if you use a different version manager.
        let candidates = nodeCandidatePaths()
        guard let node = candidates.first(where: { FileManager.default.fileExists(atPath: $0) }) else {
            lastError = "node not found. Searched: \(candidates.joined(separator: ", "))"
            completion(false)
            return
        }

        let tsxPath = "\(path)/node_modules/.bin/tsx"
        guard FileManager.default.fileExists(atPath: tsxPath) else {
            lastError = "tsx not found at \(tsxPath). Run `npm install` in \(path)."
            completion(false)
            return
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: node)
        proc.arguments = [tsxPath, "src/index.ts"]
        proc.currentDirectoryURL = URL(fileURLWithPath: path)

        // Make sure node can find npm-bin dependencies + system tools.
        var env = ProcessInfo.processInfo.environment
        let nodeDir = (node as NSString).deletingLastPathComponent
        let existingPath = env["PATH"] ?? ""
        env["PATH"] = "\(nodeDir):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:\(existingPath)"
        proc.environment = env

        // Pipe both stdout + stderr to ~/Library/Logs/Lighthouse.log so the
        // user can tail it if something goes wrong post-launch.
        let logPath = NSString(string: "~/Library/Logs/Lighthouse.log").expandingTildeInPath
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        if let logHandle = FileHandle(forWritingAtPath: logPath) {
            logHandle.seekToEndOfFile()
            let banner = "\n=== Lighthouse launched \(Date()) ===\n"
            if let data = banner.data(using: .utf8) { logHandle.write(data) }
            proc.standardOutput = logHandle
            proc.standardError = logHandle
        }

        do {
            try proc.run()
            self.process = proc
            // Poll up to ~15 seconds for the server to come up (first boot
            // includes a TS transpile pass; cold start can be slow).
            waitForServer(retries: 30, completion: completion)
        } catch {
            lastError = "Failed to spawn node: \(error.localizedDescription)"
            completion(false)
        }
    }

    private func waitForServer(retries: Int, completion: @escaping (Bool) -> Void) {
        if retries <= 0 {
            lastError = "Server didn't respond on :7373 after 15s. Check ~/Library/Logs/Lighthouse.log."
            completion(false)
            return
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.checkServerAlive { alive in
                if alive {
                    completion(true)
                } else {
                    self?.waitForServer(retries: retries - 1, completion: completion)
                }
            }
        }
    }

    private func nodeCandidatePaths() -> [String] {
        var paths = [
            "/opt/homebrew/bin/node",  // Apple Silicon Homebrew
            "/usr/local/bin/node",     // Intel Homebrew
        ]
        // Probe nvm install dirs — typical layout is ~/.nvm/versions/node/vX.Y.Z/bin/node.
        // Pick the lexicographically highest version available.
        let nvmRoot = NSString(string: "~/.nvm/versions/node").expandingTildeInPath
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmRoot) {
            let nvmPaths = versions
                .sorted(by: >)
                .map { "\(nvmRoot)/\($0)/bin/node" }
            paths.append(contentsOf: nvmPaths)
        }
        return paths
    }
}

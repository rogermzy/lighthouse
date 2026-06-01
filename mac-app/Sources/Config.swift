import Foundation

/// Resolves the URL the webview points at. Default is the local backend
/// (http://127.0.0.1:7373). To point the app at a remote host (e.g., a
/// Mac mini on the same Tailscale tailnet), set the UserDefaults override
/// once — no rebuild required:
///
///     defaults write com.rogermzy.lighthouse LighthouseRemoteURL \
///         "https://mini.tailnet-name.ts.net"
///
/// Setting this also disables the local-server bootstrap: the app assumes
/// something else is running the backend (a launchd unit on the mini) and
/// just renders the URL.
///
/// Clear with:
///     defaults delete com.rogermzy.lighthouse LighthouseRemoteURL
enum Config {
    /// The configured remote base URL, or nil if running in local mode.
    static var remoteBaseURL: URL? {
        guard let raw = UserDefaults.standard.string(forKey: "LighthouseRemoteURL"),
              !raw.isEmpty,
              let url = URL(string: raw),
              url.scheme != nil
        else { return nil }
        return url
    }

    /// True when pointing at a remote backend — Mac app must skip the
    /// "spawn a Node child process" path and just load the URL.
    static var isRemote: Bool { remoteBaseURL != nil }

    /// Base URL the webview should load. Falls back to local.
    static var baseURL: URL {
        remoteBaseURL ?? URL(string: "http://127.0.0.1:7373")!
    }

    /// Health-probe URL — used both to detect a pre-existing local server
    /// and (in remote mode) to confirm the remote is reachable before
    /// loading the UI, so we can surface a clear error if Tailscale is
    /// off or the mini is down.
    static var healthURL: URL {
        baseURL.appendingPathComponent("api/meta")
    }
}

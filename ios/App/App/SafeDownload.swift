import Foundation

/**
 * The iPhone's counterpart of src/search/downloader.js and android/…/SafeDownload.java — the only way remote bytes reach the phone:
 *  - https only, no IP literals / local names, and every redirect hop must resolve to public addresses only
 *  - the server must say it is sending audio (or binary with an audio file extension)
 *  - a hard size cap; the format is read from the first bytes, never trusted from the name
 *  - saved into the app's Documents/Soft&Deep Sound (visible in the Files app), never overwriting
 */
enum SafeDownload {
    struct Fail: LocalizedError {
        let msg: String
        init(_ m: String) { msg = m }
        var errorDescription: String? { msg }
    }
    /// the server simply has no such image: no artwork, not an error
    struct NoImage: Error {}

    static let maxBytes: Int64 = 300 * 1024 * 1024
    static let maxImage: Int64 = 6 * 1024 * 1024
    static let folder = "Soft&Deep Sound"
    /// where album artwork may come from: the Cover Art Archive (and archive.org, where it lives), Deezer's and Apple's CDNs
    static let imageHosts = "(^|.*\\.)(coverartarchive\\.org|archive\\.org|dzcdn\\.net|mzstatic\\.com)$"

    /// a track from the open-sources web search; @return the saved file
    static func audio(url: String, referer: String?, name: String, into docs: URL, progress: @escaping (Int64, Int64) -> Void) throws -> URL {
        guard let start = URL(string: url) else { throw Fail("https only") }
        var req = URLRequest(url: start, timeoutInterval: 20) // 20 s without a single byte: the server has stalled
        req.setValue("Mozilla/5.0 (iPhone) SoftDeepSound/1.2", forHTTPHeaderField: "User-Agent")
        req.setValue("audio/*,*/*;q=0.8", forHTTPHeaderField: "Accept")
        if let r = referer, r.hasPrefix("https://") { req.setValue(r, forHTTPHeaderField: "Referer") }
        let f = Fetch(limit: maxBytes, progress: progress) { h in
            guard (200..<300).contains(h.statusCode) else { throw Fail("HTTP \(h.statusCode)") }
            let type = (h.value(forHTTPHeaderField: "Content-Type") ?? "null").lowercased()
            let path = (h.url?.path ?? "").lowercased()
            let audioExt = path.range(of: "\\.(mp3|ogg|flac|wav|m4a|opus)$", options: .regularExpression) != nil
            let ok = type.hasPrefix("audio/") || type.contains("ogg")
                || ((type.contains("octet-stream") || type.contains("binary") || type == "null") && audioExt)
            if !ok { throw Fail("not-audio \(type)") }
        }
        let tmp = try f.run(req)
        defer { try? FileManager.default.removeItem(at: tmp) }
        guard let ext = sniff(f.head) else { throw Fail("not-audio-bytes") }
        let dir = docs.appendingPathComponent(folder, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let base = sanitize(name)
        var dest = dir.appendingPathComponent(base + "." + ext)
        var i = 2
        while FileManager.default.fileExists(atPath: dest.path) { dest = dir.appendingPathComponent("\(base) (\(i)).\(ext)"); i += 1 }
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    /**
     * Album artwork for the library repair (renderer/js/mb-repair.js) into `out`. Same rules as audio — https,
     * public addresses, every redirect checked — plus a short list of artwork hosts, an image content type
     * and a 6 MB cap. @return false when the server has no such image
     */
    static func image(url: String, to out: URL) throws -> Bool {
        guard let start = URL(string: url) else { throw Fail("https only") }
        var req = URLRequest(url: start, timeoutInterval: 20)
        req.setValue("SoftDeepSound (iOS; https://github.com/infallibl3/soft-deep-sound)", forHTTPHeaderField: "User-Agent")
        req.setValue("image/*", forHTTPHeaderField: "Accept")
        let f = Fetch(limit: maxImage, progress: nil, extraCheck: { u in
            if (u.host ?? "").lowercased().range(of: imageHosts, options: .regularExpression) == nil { throw Fail("blocked host") }
        }) { h in
            if h.statusCode == 404 { throw NoImage() }
            guard h.statusCode == 200 else { throw Fail("HTTP \(h.statusCode)") }
            if !(h.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased().hasPrefix("image/") { throw NoImage() }
        }
        let tmp: URL
        do { tmp = try f.run(req) } catch is NoImage { return false } catch let e as Fail where e.msg == "too-big" { return false }
        if f.received == 0 { try? FileManager.default.removeItem(at: tmp); return false }
        try? FileManager.default.removeItem(at: out)
        try FileManager.default.moveItem(at: tmp, to: out)
        return true
    }

    static func assertSafe(_ u: URL) throws {
        guard u.scheme?.lowercased() == "https", var h = u.host?.lowercased(), !h.isEmpty else { throw Fail("https only") }
        if h.hasSuffix(".") { h.removeLast() }
        if h == "localhost" || h.hasSuffix(".localhost") || h.hasSuffix(".local") || h.hasSuffix(".internal")
            || h.contains(":") || h.range(of: "^[0-9.]+$", options: .regularExpression) != nil { throw Fail("blocked address") }
        let all = resolve(h)
        if all.isEmpty || all.contains(where: isPrivate) { throw Fail("blocked address") }
    }

    /// every address the name resolves to, as raw bytes (4 for IPv4, 16 for IPv6)
    static func resolve(_ host: String) -> [[UInt8]] {
        var hints = addrinfo()
        hints.ai_socktype = SOCK_STREAM
        var res: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &res) == 0, let first = res else { return [] }
        defer { freeaddrinfo(first) }
        var out: [[UInt8]] = []
        var p: UnsafeMutablePointer<addrinfo>? = first
        while let ai = p {
            if let sa = ai.pointee.ai_addr {
                if ai.pointee.ai_family == AF_INET {
                    sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { s in var a = s.pointee.sin_addr; out.append(withUnsafeBytes(of: &a) { Array($0) }) }
                } else if ai.pointee.ai_family == AF_INET6 {
                    sa.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { s in var a = s.pointee.sin6_addr; out.append(withUnsafeBytes(of: &a) { Array($0) }) }
                }
            }
            p = ai.pointee.ai_next
        }
        return out
    }

    /// private, loopback, link-local, carrier-grade NAT, multicast — mirrors isPrivateIp in src/search/http.js
    static func isPrivate(_ b: [UInt8]) -> Bool {
        if b.count == 4 {
            let x = b[0], y = b[1]
            return x == 0 || x == 10 || x == 127 || (x == 169 && y == 254) || (x == 172 && y >= 16 && y <= 31)
                || (x == 192 && y == 168) || (x == 100 && y >= 64 && y <= 127) || x >= 224
        }
        if b.count == 16 {
            if b[0..<15].allSatisfy({ $0 == 0 }) && b[15] <= 1 { return true } // :: and ::1
            if b[0..<10].allSatisfy({ $0 == 0 }) && b[10] == 0xff && b[11] == 0xff { return isPrivate(Array(b[12..<16])) } // ::ffff:a.b.c.d
            return (b[0] & 0xfe) == 0xfc || (b[0] == 0xfe && (b[1] & 0xc0) == 0x80) || b[0] == 0xff
        }
        return true
    }

    static func sniff(_ d: Data) -> String? {
        let b = [UInt8](d)
        guard b.count >= 12 else { return nil }
        let s4 = String(bytes: b[0..<4], encoding: .isoLatin1) ?? ""
        if s4.hasPrefix("ID3") { return "mp3" }
        if b[0] == 0xff && (b[1] & 0xe0) == 0xe0 { return "mp3" }
        if s4 == "fLaC" { return "flac" }
        if s4 == "OggS" { return "ogg" }
        if s4 == "RIFF" && String(bytes: b[8..<12], encoding: .isoLatin1) == "WAVE" { return "wav" }
        if String(bytes: b[4..<8], encoding: .isoLatin1) == "ftyp" { return "m4a" }
        return nil
    }

    static func sanitize(_ s: String) -> String {
        var out = s.replacingOccurrences(of: "[<>:\"/\\\\|?*\\x00-\\x1f]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if out.count > 120 { out = String(out.prefix(120)) }
        return out.isEmpty ? "track" : out
    }
}

/// one checked request: every hop is vetted before it is followed, the body streams to a temp file under a size cap
private final class Fetch: NSObject, URLSessionDataDelegate {
    let limit: Int64
    let progress: ((Int64, Int64) -> Void)?
    let extraCheck: ((URL) throws -> Void)?
    let accept: (HTTPURLResponse) throws -> Void
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("sds-" + UUID().uuidString + ".part")
    var out: FileHandle?
    var head = Data()
    var received: Int64 = 0
    var total: Int64 = -1
    var failure: Error?
    var hops = 0
    var lastEmit = Date.distantPast
    let done = DispatchSemaphore(value: 0)

    init(limit: Int64, progress: ((Int64, Int64) -> Void)?, extraCheck: ((URL) throws -> Void)? = nil, accept: @escaping (HTTPURLResponse) throws -> Void) {
        self.limit = limit; self.progress = progress; self.extraCheck = extraCheck; self.accept = accept
    }

    func check(_ u: URL) throws { try SafeDownload.assertSafe(u); try extraCheck?(u) }

    func run(_ req: URLRequest) throws -> URL {
        try check(req.url!)
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForResource = 30 * 60
        let session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
        session.dataTask(with: req).resume()
        done.wait()
        session.finishTasksAndInvalidate()
        if let e = failure { try? FileManager.default.removeItem(at: tmp); throw e }
        return tmp
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        hops += 1
        do {
            if hops > 6 { throw SafeDownload.Fail("too many redirects") }
            guard let u = request.url else { throw SafeDownload.Fail("https only") }
            try check(u)
            completionHandler(request)
        } catch { failure = error; completionHandler(nil); task.cancel() }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        do {
            guard let h = response as? HTTPURLResponse else { throw SafeDownload.Fail("HTTP 0") }
            try accept(h)
            total = h.expectedContentLength
            if total > limit { throw SafeDownload.Fail("too-big") }
            FileManager.default.createFile(atPath: tmp.path, contents: nil)
            out = try FileHandle(forWritingTo: tmp)
            completionHandler(.allow)
        } catch { failure = error; completionHandler(.cancel) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        received += Int64(data.count)
        if received > limit { failure = SafeDownload.Fail("too-big"); dataTask.cancel(); return }
        if head.count < 16 { head.append(data.prefix(16 - head.count)) }
        out?.write(data)
        if let p = progress, Date().timeIntervalSince(lastEmit) > 0.15 { lastEmit = Date(); p(received, total) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        try? out?.close()
        if failure == nil, let e = error { failure = SafeDownload.Fail((e as NSError).code == NSURLErrorTimedOut ? "timeout" : e.localizedDescription) }
        done.signal()
    }
}

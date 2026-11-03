import UIKit
import Capacitor
import AVFoundation
import UniformTypeIdentifiers

/**
 * The iPhone's music: iOS shows an app no other app's files, so the library is the app's own Documents folder
 * («On My iPhone → Soft&Deep Sound» in the Files app). Music comes in through the system file picker (copied in),
 * through Files / Finder, or from the web search. Tags and artwork are read with AVFoundation and remembered
 * per file, so a rescan only reads what changed.
 *
 * Paths given to the page are stable — «/Documents/…» and «/Caches/…» — because the real container path
 * changes when the app is reinstalled (AltStore re-signs it every week); `roots` tells the page where they are now.
 */
@objc(MusicLibrary) // the JS name: Capacitor can also find the plugin by it
public class MusicLibraryPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "MusicLibraryPlugin"
    public let jsName = "MusicLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "roots", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exists", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveCover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise)
    ]

    static let audioExt: Set<String> = ["mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "aac"]
    let fm = FileManager.default
    lazy var docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath()
    lazy var caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath()
    var coversDir: URL { caches.appendingPathComponent("covers", isDirectory: true) }
    var indexFile: URL { caches.appendingPathComponent("library-index.json") }
    let queue = DispatchQueue(label: "sds.library", qos: .userInitiated)

    /* ------------------------------ stable paths ------------------------------ */
    func virt(_ u: URL) -> String {
        let p = u.resolvingSymlinksInPath().path
        if p.hasPrefix(docs.path + "/") { return "/Documents" + p.dropFirst(docs.path.count) }
        if p.hasPrefix(caches.path + "/") { return "/Caches" + p.dropFirst(caches.path.count) }
        return p
    }
    func real(_ p: String) -> URL? {
        if p.hasPrefix("/Documents/") { return docs.appendingPathComponent(String(p.dropFirst(11))) }
        if p.hasPrefix("/Caches/") { return caches.appendingPathComponent(String(p.dropFirst(8))) }
        return nil
    }
    /// FNV-1a: a short stable name for a path (track ids, artwork files)
    static func hash(_ s: String) -> String {
        var h: UInt64 = 0xcbf29ce484222325
        for b in s.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return String(h, radix: 16)
    }

    @objc func roots(_ call: CAPPluginCall) {
        call.resolve(["documents": docs.path, "caches": caches.path])
    }

    /* --------------------------------- scan --------------------------------- */
    @objc func scan(_ call: CAPPluginCall) {
        queue.async {
            let index = (try? JSONSerialization.jsonObject(with: Data(contentsOf: self.indexFile))) as? [String: [String: Any]] ?? [:]
            var next: [String: [String: Any]] = [:]
            var tracks: [[String: Any]] = []
            let keys: [URLResourceKey] = [.isRegularFileKey, .contentModificationDateKey, .fileSizeKey, .creationDateKey]
            if let en = self.fm.enumerator(at: self.docs, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]) {
                for case let u as URL in en {
                    guard Self.audioExt.contains(u.pathExtension.lowercased()),
                          let v = try? u.resourceValues(forKeys: Set(keys)), v.isRegularFile == true else { continue }
                    let p = self.virt(u)
                    let mtime = v.contentModificationDate?.timeIntervalSince1970 ?? 0
                    let size = v.fileSize ?? 0
                    var t: [String: Any]
                    if let old = index[p], old["mtime"] as? Double == mtime, old["size"] as? Int == size { t = old }
                    else {
                        t = self.readTags(u, key: Self.hash(p))
                        t["mtime"] = mtime
                        t["size"] = size
                        t["addedAt"] = (v.creationDate?.timeIntervalSince1970 ?? Date().timeIntervalSince1970) * 1000
                    }
                    next[p] = t
                    var out = t
                    out["path"] = p
                    out["id"] = "i" + Self.hash(p)
                    tracks.append(out)
                }
            }
            if let d = try? JSONSerialization.data(withJSONObject: next) { try? d.write(to: self.indexFile, options: .atomic) }
            tracks.sort { ($0["addedAt"] as? Double ?? 0) > ($1["addedAt"] as? Double ?? 0) }
            call.resolve(["tracks": tracks])
        }
    }

    /// title, artist, album, year and length from the file's own tags; embedded artwork saved once as a small JPEG
    func readTags(_ u: URL, key: String) -> [String: Any] {
        let a = AVURLAsset(url: u)
        var t: [String: Any] = ["title": "", "artist": "", "album": "", "duration": 0]
        let d = CMTimeGetSeconds(a.duration)
        if d.isFinite && d > 0 { t["duration"] = d }
        for item in a.commonMetadata {
            switch item.commonKey {
            case .commonKeyTitle?: t["title"] = item.stringValue ?? ""
            case .commonKeyArtist?: t["artist"] = item.stringValue ?? ""
            case .commonKeyAlbumName?: t["album"] = item.stringValue ?? ""
            case .commonKeyCreationDate?:
                if let s = item.stringValue, let y = Int(s.prefix(4)), y > 0 { t["year"] = y }
            case .commonKeyArtwork?:
                if t["cover"] == nil, let data = item.dataValue, let c = saveArtwork(data, key: key) { t["cover"] = c }
            default: break
            }
        }
        return t
    }

    func saveArtwork(_ data: Data, key: String) -> String? {
        guard let img = UIImage(data: data) else { return nil }
        let side: CGFloat = 512, scale = min(1, side / max(img.size.width, img.size.height))
        let size = CGSize(width: max(1, img.size.width * scale), height: max(1, img.size.height * scale))
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpg = small.jpegData(compressionQuality: 0.88) else { return nil }
        try? fm.createDirectory(at: coversDir, withIntermediateDirectories: true)
        let f = coversDir.appendingPathComponent(key + ".jpg")
        guard (try? jpg.write(to: f, options: .atomic)) != nil else { return nil }
        return virt(f)
    }

    /* -------------------------------- import -------------------------------- */
    var pickCall: CAPPluginCall?
    var pickFolder = false

    /// «Add music» / «Folder»: the system picker (iCloud Drive, On My iPhone, USB drives…); files are copied in
    @objc func importFiles(_ call: CAPPluginCall) {
        let folder = call.getBool("folder") ?? false
        DispatchQueue.main.async {
            let audio: [UTType] = [.audio] + ["flac", "ogg", "oga", "opus"].compactMap { UTType(filenameExtension: $0) }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: folder ? [.folder] : audio, asCopy: !folder)
            picker.allowsMultipleSelection = !folder
            picker.delegate = self
            self.pickCall?.resolve(["paths": []])
            self.pickCall = call
            self.pickFolder = folder
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCall?.resolve(["paths": []])
        pickCall = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickCall else { return }
        pickCall = nil
        let folder = pickFolder
        queue.async {
            var added: [String] = []
            for u in urls {
                if folder {
                    let ok = u.startAccessingSecurityScopedResource()
                    defer { if ok { u.stopAccessingSecurityScopedResource() } }
                    let dest = self.docs.appendingPathComponent(u.lastPathComponent, isDirectory: true)
                    guard let en = self.fm.enumerator(at: u, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else { continue }
                    for case let f as URL in en where Self.audioExt.contains(f.pathExtension.lowercased()) {
                        let rel = f.resolvingSymlinksInPath().path.dropFirst(u.resolvingSymlinksInPath().path.count).drop { $0 == "/" }
                        let target = dest.appendingPathComponent(String(rel))
                        // the same folder picked again: what is already here stays, only new files come in
                        if !self.fm.fileExists(atPath: target.path) {
                            try? self.fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                            if (try? self.fm.copyItem(at: f, to: target)) == nil { continue }
                        }
                        added.append(self.virt(target))
                    }
                } else {
                    added.append(self.virt(self.bringIn(u)))
                }
            }
            call.resolve(["paths": added])
        }
    }

    /// a picked copy into Documents; the same file picked twice is not doubled
    func bringIn(_ u: URL) -> URL {
        let name = u.deletingPathExtension().lastPathComponent, ext = u.pathExtension
        let size = (try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1
        var dest = docs.appendingPathComponent(u.lastPathComponent)
        var i = 2
        while fm.fileExists(atPath: dest.path) {
            if (try? dest.resourceValues(forKeys: [.fileSizeKey]).fileSize) == size { try? fm.removeItem(at: u); return dest }
            dest = docs.appendingPathComponent("\(name) (\(i)).\(ext)")
            i += 1
        }
        if (try? fm.moveItem(at: u, to: dest)) == nil { try? fm.copyItem(at: u, to: dest) }
        return dest
    }

    /* ------------------------------ files & web ------------------------------ */
    @objc func exists(_ call: CAPPluginCall) {
        let paths = call.getArray("paths", String.self) ?? []
        call.resolve(["exists": paths.map { p in real(p).map { fm.isReadableFile(atPath: $0.path) } ?? false }])
    }

    /// album artwork found by the library repair; `key` names the file (one per album)
    @objc func saveCover(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? "", key = call.getString("key") ?? ""
        guard key.range(of: "^[a-z0-9-]{4,64}$", options: .regularExpression) != nil else { call.reject("bad key"); return }
        DispatchQueue.global(qos: .utility).async {
            do {
                try? self.fm.createDirectory(at: self.coversDir, withIntermediateDirectories: true)
                let f = self.coversDir.appendingPathComponent("web-" + key + ".jpg")
                let size = (try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if size > 0 { call.resolve(["path": self.virt(f)]); return }
                if try SafeDownload.image(url: url, to: f) { call.resolve(["path": self.virt(f)]) } else { call.resolve([:]) }
            } catch { call.reject(error.localizedDescription) }
        }
    }

    /// a track from the open-sources web search into Documents/Soft&Deep Sound; progress as «download» events
    @objc func download(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? "", url = call.getString("url") ?? "", referer = call.getString("referer"), name = call.getString("name") ?? "track"
        DispatchQueue.global(qos: .utility).async {
            do {
                let f = try SafeDownload.audio(url: url, referer: referer, name: name, into: self.docs) { received, total in
                    self.notifyListeners("download", data: ["id": id, "received": received, "total": total])
                }
                call.resolve(["path": self.virt(f)])
            } catch { call.reject(error.localizedDescription) }
        }
    }
}

import UIKit
import Capacitor

/// The iPhone side of android/…/MediaControlsPlugin.java. The lock screen and Control Center are fed by
/// WebKit itself from the page's navigator.mediaSession, so update / stop have nothing to do here.
@objc(MediaControls) // the JS name: Capacitor can also find the plugin by it
public class MediaControlsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MediaControlsPlugin"
    public let jsName = "MediaControls"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "minimize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBars", returnType: CAPPluginReturnPromise)
    ]

    @objc func update(_ call: CAPPluginCall) { call.resolve() }
    @objc func stop(_ call: CAPPluginCall) { call.resolve() }
    /// iOS apps never send themselves to the background: «Back» on the main screen simply stays
    @objc func minimize(_ call: CAPPluginCall) { call.resolve() }

    /// a link from the page (a lyrics source, the project page) opens in Safari; https only
    @objc func openUrl(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), s.hasPrefix("https://"), let url = URL(string: s) else { call.reject("https only"); return }
        DispatchQueue.main.async { UIApplication.shared.open(url); call.resolve() }
    }

    @objc func setBars(_ call: CAPPluginCall) {
        let light = call.getBool("light") ?? true
        DispatchQueue.main.async {
            (self.bridge?.viewController as? ViewController)?.lightTheme = light
            call.resolve()
        }
    }
}

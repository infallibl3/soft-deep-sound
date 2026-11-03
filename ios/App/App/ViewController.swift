import UIKit
import Capacitor

/// The page's own plugins live in the app target, so Capacitor is told about them here (Main.storyboard uses this class).
class ViewController: CAPBridgeViewController {
    /// status bar icons follow the theme (MediaControls.setBars): dark on light themes, light on dark ones
    var lightTheme = true { didSet { setNeedsStatusBarAppearanceUpdate() } }
    override var preferredStatusBarStyle: UIStatusBarStyle { lightTheme ? .darkContent : .lightContent }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MusicLibraryPlugin())
        bridge?.registerPluginInstance(MediaControlsPlugin())
    }
}

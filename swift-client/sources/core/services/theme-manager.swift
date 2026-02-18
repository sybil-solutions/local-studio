// CRITICAL
import SwiftUI

/// Environment object for managing the current theme
@MainActor
final class ThemeManager: ObservableObject {
    @Published var currentTheme: AppTheme
    
    init(settingsStore: SettingsStore) {
        let selectedTheme = AppTheme.all.first { $0.id == settingsStore.themeId } ?? AppTheme.default
        self.currentTheme = selectedTheme
        AppTheme.current = selectedTheme
    }
    
    func setTheme(byId id: String) {
        if let theme = AppTheme.all.first(where: { $0.id == id }) {
            updateTheme(theme)
        } else {
            updateTheme(AppTheme.default)
        }
    }
    
    func setTheme(_ theme: AppTheme) {
        updateTheme(theme)
    }
    
    private func updateTheme(_ theme: AppTheme) {
        currentTheme = theme
        AppTheme.current = theme
    }
}

/// Environment key for theme
struct ThemeKey: EnvironmentKey {
    static let defaultValue: ThemeManager = MainActor.assumeIsolated {
        ThemeManager(settingsStore: SettingsStore())
    }
}

extension EnvironmentValues {
    var theme: ThemeManager {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

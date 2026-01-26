import Foundation

final class AppContainer: ObservableObject {
  @Published var settings = SettingsStore()
  lazy var api = ApiClient(settings: settings)
}

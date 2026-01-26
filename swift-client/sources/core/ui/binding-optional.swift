import SwiftUI

extension Binding where Value == String? {
  init(_ source: Binding<String?>, _ defaultValue: String) {
    self.init(get: { source.wrappedValue ?? defaultValue }, set: { source.wrappedValue = $0 })
  }
}

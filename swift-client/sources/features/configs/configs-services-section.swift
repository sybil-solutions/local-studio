import SwiftUI

struct ConfigsServicesSection: View {
  let services: [ServiceInfo]?

  var body: some View {
    if let services {
      Section("Services") {
        ForEach(services, id: \.name) { service in
          HStack {
            VStack(alignment: .leading) {
              Text(service.name)
              Text("Port \(service.port)").font(.caption).foregroundColor(AppTheme.muted)
            }
            Spacer()
            BadgeView(text: service.status, color: badge(for: service.status))
          }
        }
      }
    }
  }

  private func badge(for status: String) -> Color {
    switch status {
    case "running": return AppTheme.success
    case "stopped": return AppTheme.muted
    default: return AppTheme.warning
    }
  }
}

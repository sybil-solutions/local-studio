import SwiftUI

struct ProgressBar: View {
  let value: Double

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(AppTheme.border)
        Capsule().fill(AppTheme.accentStrong).frame(width: geo.size.width * value)
      }
    }
    .frame(height: 6)
  }
}

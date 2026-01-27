import SwiftUI

struct ArtifactCard: View {
  let artifact: Artifact
  let onTap: () -> Void

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: 10) {
        Image(systemName: artifact.type.icon)
          .font(.system(size: 14))
          .foregroundColor(AppTheme.foreground)
          .frame(width: 32, height: 32)
          .background(AppTheme.card)
          .cornerRadius(8)

        VStack(alignment: .leading, spacing: 2) {
          Text(artifact.title.isEmpty ? artifact.type.label : artifact.title)
            .font(AppTheme.captionFont.weight(.medium))
            .foregroundColor(AppTheme.foreground)
            .lineLimit(1)

          Text(artifact.type.label)
            .font(.system(size: 10, weight: .medium))
            .foregroundColor(AppTheme.muted)
        }

        Spacer()

        Image(systemName: "arrow.up.right")
          .font(.system(size: 11, weight: .medium))
          .foregroundColor(AppTheme.muted)
      }
      .padding(10)
      .background(AppTheme.card)
      .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.border, lineWidth: 1))
      .cornerRadius(12)
    }
    .buttonStyle(.plain)
  }
}

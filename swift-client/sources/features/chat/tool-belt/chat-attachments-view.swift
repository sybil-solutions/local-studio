import SwiftUI
import UIKit

struct ChatAttachmentsView: View {
  let attachments: [ChatAttachment]
  let onRemove: (ChatAttachment) -> Void

  var body: some View {
    if !attachments.isEmpty {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(attachments) { attachment in
            HStack(spacing: 6) {
              if let image = attachment.image {
                Image(uiImage: image).resizable().scaledToFill().frame(width: 28, height: 28).clipped().cornerRadius(6)
              } else {
                Image(systemName: icon(for: attachment.type))
              }
              Text(attachment.name).font(AppTheme.captionFont)
              Button(action: { onRemove(attachment) }) { Image(systemName: "xmark.circle.fill") }
            }
            .padding(6)
            .background(AppTheme.card)
            .cornerRadius(10)
          }
        }
        .padding(.horizontal, 16)
      }
    }
  }

  private func icon(for type: ChatAttachmentType) -> String {
    switch type {
    case .image: "photo"
    case .file: "doc"
    case .audio: "waveform"
    }
  }
}

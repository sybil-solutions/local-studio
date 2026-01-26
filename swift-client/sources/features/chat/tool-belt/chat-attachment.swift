import Foundation
import UIKit

enum ChatAttachmentType {
  case image
  case file
  case audio
}

struct ChatAttachment: Identifiable {
  let id: String
  let name: String
  let type: ChatAttachmentType
  let url: URL?
  let image: UIImage?
}

import Foundation

struct AnyEncodable: Encodable {
  let value: Any
  init(_ value: Any) { self.value = value }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch value {
    case let v as String: try container.encode(v)
    case let v as Int: try container.encode(v)
    case let v as Double: try container.encode(v)
    case let v as Bool: try container.encode(v)
    case let v as [Any]: try container.encode(v.map { AnyEncodable($0) })
    case let v as [String: Any]:
      try container.encode(v.mapValues { AnyEncodable($0) })
    default: try container.encodeNil()
    }
  }
}

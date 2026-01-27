import Foundation

enum AnyCodable: Codable {
  case string(String), int(Int), double(Double), bool(Bool), array([AnyCodable]), object([String: AnyCodable]), null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null; return }
    if let value = try? container.decode(Bool.self) { self = .bool(value); return }
    if let value = try? container.decode(Int.self) { self = .int(value); return }
    if let value = try? container.decode(Double.self) { self = .double(value); return }
    if let value = try? container.decode(String.self) { self = .string(value); return }
    if let value = try? container.decode([String: AnyCodable].self) { self = .object(value); return }
    if let value = try? container.decode([AnyCodable].self) { self = .array(value); return }
    self = .null
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let value): try container.encode(value)
    case .int(let value): try container.encode(value)
    case .double(let value): try container.encode(value)
    case .bool(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    case .null: try container.encodeNil()
    }
  }

  var anyValue: Any {
    switch self {
    case .string(let value): return value
    case .int(let value): return value
    case .double(let value): return value
    case .bool(let value): return value
    case .array(let value): return value.map { $0.anyValue }
    case .object(let value): return value.mapValues { $0.anyValue }
    case .null: return NSNull()
    }
  }

  var stringValue: String {
    switch self {
    case .string(let v): return v
    case .int(let v): return String(v)
    case .double(let v): return String(v)
    case .bool(let v): return String(v)
    case .array(let v): return v.map { $0.stringValue }.joined(separator: ",")
    case .object(let v): return v.mapValues { $0.stringValue }.description
    case .null: return ""
    }
  }
}

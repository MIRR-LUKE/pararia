import Foundation
import Security

final class KeychainTeacherTokenStore: TeacherTokenStore {
    private let service = "jp.pararia.teacher.native"
    private let account = "teacher-auth-bundle"

    func loadAuthBundle() -> TeacherAuthBundle? {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(TeacherAuthBundle.self, from: data)
    }

    func save(authBundle: TeacherAuthBundle) throws {
        let data = try JSONEncoder().encode(authBundle)
        try clear()
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecValueData: data
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "TeacherTokenStore", code: Int(status))
        }
    }

    func clear() throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: "TeacherTokenStore", code: Int(status))
        }
    }
}

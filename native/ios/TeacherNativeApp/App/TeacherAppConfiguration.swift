import Foundation

struct TeacherAppConfiguration {
    let apiBaseURL: URL

    static var current: TeacherAppConfiguration {
        let configuredValue = Bundle.main.object(forInfoDictionaryKey: "PARARIAApiBaseURL") as? String
        let fallbackValue = "https://pararia.vercel.app"
        let rawValue = (configuredValue?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            ? configuredValue!
            : fallbackValue

        guard let url = URL(string: rawValue) else {
            fatalError("PARARIAApiBaseURL が不正です。")
        }

        return TeacherAppConfiguration(apiBaseURL: url)
    }
}

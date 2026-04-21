import SwiftUI

@main
struct TeacherNativeAppApp: App {
    @StateObject private var coordinator = TeacherAppContainer.makeCoordinator()

    var body: some Scene {
        WindowGroup {
            TeacherAppRootView(coordinator: coordinator)
        }
    }
}

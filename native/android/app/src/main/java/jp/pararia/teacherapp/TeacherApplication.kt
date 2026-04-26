package jp.pararia.teacherapp

import android.app.Application
import jp.pararia.teacherapp.app.TeacherAppContainer
import jp.pararia.teacherapp.diagnostics.TeacherDiagnostics
import jp.pararia.teacherapp.notifications.TeacherNotificationInitializer

class TeacherApplication : Application() {
    val container: TeacherAppContainer by lazy {
        TeacherAppContainer(this)
    }

    override fun onCreate() {
        super.onCreate()
        TeacherNotificationInitializer.initialize(this)
        TeacherDiagnostics.track("app_bootstrap")
    }
}

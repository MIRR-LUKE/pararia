package jp.pararia.teacherapp

import android.app.Application
import jp.pararia.teacherapp.app.TeacherAppContainer
import jp.pararia.teacherapp.diagnostics.TeacherDiagnostics

class TeacherApplication : Application() {
    val container: TeacherAppContainer by lazy {
        TeacherAppContainer(this)
    }

    override fun onCreate() {
        super.onCreate()
        TeacherDiagnostics.track("app_bootstrap")
    }
}

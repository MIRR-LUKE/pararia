package jp.pararia.teacherapp

import android.app.Application
import jp.pararia.teacherapp.app.TeacherAppContainer

class TeacherApplication : Application() {
    val container: TeacherAppContainer by lazy {
        TeacherAppContainer(this)
    }
}

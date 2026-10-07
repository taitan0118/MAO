// Gọi Node.js (nodejs-mobile) từ Java. Node cần các tham số nằm liền nhau trong bộ nhớ.
#include <jni.h>
#include <cstdlib>
#include <cstring>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>
#include <vector>
#include <string>
#include "node.h"

static int pipes[2];
static void *log_thread(void *) { // chuyển console.log của Node sang logcat (adb logcat -s MAO-NODE)
    char buf[2048]; ssize_t n;
    while ((n = read(pipes[0], buf, sizeof buf - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(ANDROID_LOG_INFO, "MAO-NODE", buf);
    }
    return nullptr;
}

extern "C" JNIEXPORT jint JNICALL
Java_vn_mao_app_NodeService_startNode(JNIEnv *env, jclass, jobjectArray arguments) {
    jsize count = env->GetArrayLength(arguments);
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < count; i++) {
        auto js = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *c = env->GetStringUTFChars(js, nullptr);
        args.emplace_back(c);
        env->ReleaseStringUTFChars(js, c);
        total += args.back().size() + 1;
    }
    char *buffer = (char *) calloc(total, 1);
    std::vector<char *> argv;
    char *pos = buffer;
    for (auto &a : args) { memcpy(pos, a.c_str(), a.size()); argv.push_back(pos); pos += a.size() + 1; }

    setvbuf(stdout, nullptr, _IOLBF, 0); setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipes) == 0) {
        dup2(pipes[1], STDOUT_FILENO); dup2(pipes[1], STDERR_FILENO);
        pthread_t t; if (pthread_create(&t, nullptr, log_thread, nullptr) == 0) pthread_detach(t);
    }
    return jint(node::Start((int) argv.size(), argv.data()));
}

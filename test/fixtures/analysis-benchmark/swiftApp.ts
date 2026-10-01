import type { AnalysisBenchmarkFixture } from './types.js';

/**
 * Swift 应用：跨文件扩展、隐式 self、静态限定调用、属性与参数的类型接收者、
 * init 体与属性初始值里的调用、实例化与协议遵循。
 */
export const swiftAppFixture: AnalysisBenchmarkFixture = {
  name: 'swift-app',
  language: 'swift',
  files: {
    'Sources/App/Greeter.swift': `protocol Greeter {
    func greet(name: String) -> String
}
`,
    'Sources/App/Repo.swift': `final class Repo {
    func load() -> [String] { [] }

    static func make() -> Repo {
        return Repo() // @repo.selfNew
    }
}
`,
    'Sources/App/Cache.swift': `struct Cache {
    static func build() -> Cache { Cache() }
    func read() -> Int { 0 }
}

enum Log {
    static func write(_ message: String) {}
}
`,
    'Sources/App/Service.swift': `import Foundation

final class Service: Greeter { // @service.conforms
    private let repo: Repo
    private let cache = Cache.build() // @service.cacheBuild
    var onDone: (() -> Void)?

    init(repo: Repo) {
        self.repo = repo
        configure() // @service.initConfigure
        Log.write("init") // @service.logWrite
    }

    func configure() {}

    func greet(name: String) -> String {
        let items = repo.load() // @service.repoLoad
        let names = items.map { transform($0) } // @service.transform
        finish(names) // @service.finish
        return names.joined(separator: ",") // @service.joined
    }

    func transform(_ value: String) -> String {
        return value.uppercased() // @service.uppercased
    }

    func finish(_ values: [String]) {
        onDone?()
    }
}
`,
    'Sources/App/Service+Extended.swift': `extension Service {
    func extended() -> Int {
        configure() // @extended.configure
        let other = Repo.make() // @extended.repoMake
        return other.load().count + helper() // @extended.helper
    }

    func helper() -> Int { 1 }
}
`,
    'Sources/App/Counter.swift': `actor Counter {
    private var value = 0

    func increment() { value += 1 }

    func run(service: Service) async -> String {
        increment() // @counter.increment
        return service.greet(name: "x") // @counter.greet
    }
}

func bootstrap() -> Service {
    let repo = Repo() // @bootstrap.repoNew
    let service = Service(repo: repo) // @bootstrap.serviceNew
    service.configure() // @bootstrap.configure
    return service
}
`,
  },
  expected: [
    {
      kind: 'calls',
      at: 'service.transform',
      toFile: 'Sources/App/Service.swift',
      toSymbol: 'Service.transform',
      via: 'lexical',
    },
    {
      kind: 'calls',
      at: 'service.finish',
      toFile: 'Sources/App/Service.swift',
      toSymbol: 'Service.finish',
      via: 'lexical',
    },
    {
      kind: 'calls',
      at: 'extended.helper',
      toFile: 'Sources/App/Service+Extended.swift',
      toSymbol: 'Service.helper',
      via: 'lexical',
    },
    {
      kind: 'calls',
      at: 'counter.increment',
      toFile: 'Sources/App/Counter.swift',
      toSymbol: 'Counter.increment',
      via: 'lexical',
    },
    {
      kind: 'calls',
      at: 'service.initConfigure',
      toFile: 'Sources/App/Service.swift',
      toSymbol: 'Service.configure',
      via: 'lexical',
    },
    {
      kind: 'calls',
      at: 'service.cacheBuild',
      toFile: 'Sources/App/Cache.swift',
      toSymbol: 'Cache.build',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'service.repoLoad',
      toFile: 'Sources/App/Repo.swift',
      toSymbol: 'Repo.load',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'extended.repoMake',
      toFile: 'Sources/App/Repo.swift',
      toSymbol: 'Repo.make',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'counter.greet',
      toFile: 'Sources/App/Service.swift',
      toSymbol: 'Service.greet',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'bootstrap.configure',
      toFile: 'Sources/App/Service.swift',
      toSymbol: 'Service.configure',
      via: 'external',
    },
    {
      kind: 'instantiates',
      at: 'bootstrap.repoNew',
      toFile: 'Sources/App/Repo.swift',
      toSymbol: 'Repo',
      via: 'external',
    },
    {
      kind: 'instantiates',
      at: 'bootstrap.serviceNew',
      toFile: 'Sources/App/Service.swift',
      toSymbol: 'Service',
      via: 'external',
    },
    {
      kind: 'implements',
      at: 'service.conforms',
      toFile: 'Sources/App/Greeter.swift',
      toSymbol: 'Greeter',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'service.logWrite',
      toFile: 'Sources/App/Cache.swift',
      toSymbol: 'Log.write',
      via: 'future',
    },
    {
      kind: 'calls',
      at: 'extended.configure',
      toFile: 'Sources/App/Service.swift',
      toSymbol: 'Service.configure',
      via: 'future',
    },
  ],
  mustNot: [
    { at: 'service.joined', reason: 'Array.joined 是标准库方法' },
    { at: 'service.uppercased', reason: 'String.uppercased 是标准库方法' },
  ],
};

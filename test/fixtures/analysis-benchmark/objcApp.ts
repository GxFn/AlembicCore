import type { AnalysisBenchmarkFixture } from './types.js';

/**
 * Objective-C 应用：消息发送、类方法、类别方法、C 函数、类扩展里的协议遵循。
 * `[super …]` 的三处是已知误报点：项目里存在同名方法，但接收者是父类。
 */
export const objcAppFixture: AnalysisBenchmarkFixture = {
  name: 'objc-app',
  language: 'objectivec',
  files: {
    'Models/User.h': `#import <Foundation/Foundation.h>

@interface User : NSObject
@property (nonatomic, copy) NSString *name;
@property (nonatomic, assign) NSInteger age;
- (instancetype)initWithName:(NSString *)name age:(NSInteger)age;
- (BOOL)isAdult;
+ (User *)guestUser;
@end
`,
    'Models/User.m': `#import "User.h"
#import "NSString+Validation.h"

@implementation User

- (instancetype)initWithName:(NSString *)name age:(NSInteger)age {
    self = [super init]; // @user.superInit
    if (self) {
        _name = [name copy];
        _age = age;
        [self validate]; // @user.validate
    }
    return self;
}

- (void)validate {
    if (![self.name isValidUserName]) {
        NSLog(@"invalid name"); // @user.log
    }
}

- (BOOL)isAdult {
    return self.age >= 18;
}

+ (User *)guestUser {
    return [[User alloc] initWithName:@"guest" age:0]; // @user.guestInit
}

@end
`,
    'Categories/NSString+Validation.h': `#import <Foundation/Foundation.h>

@interface NSString (Validation)
- (BOOL)isValidUserName;
- (NSString *)trimmed;
@end
`,
    'Categories/NSString+Validation.m': `#import "NSString+Validation.h"

@implementation NSString (Validation)

- (BOOL)isValidUserName {
    NSString *value = [self trimmed]; // @category.trimmed
    return [value length] > 2; // @category.length
}

- (NSString *)trimmed {
    return [self stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
}

@end
`,
    'Services/NetworkClient.h': `#import <Foundation/Foundation.h>

@class NetworkClient;

@protocol NetworkClientDelegate <NSObject>
- (void)networkClient:(NetworkClient *)client didFailWithError:(NSError *)error;
@end

typedef void (^NetworkCompletion)(NSDictionary *response, NSError *error);

@interface NetworkClient : NSObject
@property (nonatomic, weak) id<NetworkClientDelegate> delegate;
+ (instancetype)sharedClient;
- (void)GET:(NSString *)path completion:(NetworkCompletion)completion;
- (void)cancelAll;
@end
`,
    'Services/NetworkClient.m': `#import "NetworkClient.h"

static NSString *BuildURL(NSString *path) {
    return [NSString stringWithFormat:@"https://example.com/%@", path]; // @network.format
}

@implementation NetworkClient

+ (instancetype)sharedClient {
    static NetworkClient *client;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        client = [[NetworkClient alloc] init];
    });
    return client;
}

- (void)GET:(NSString *)path completion:(NetworkCompletion)completion {
    NSString *url = BuildURL(path); // @network.buildURL
    [self performRequestWithURL:url completion:completion]; // @network.perform
}

- (void)performRequestWithURL:(NSString *)url completion:(NetworkCompletion)completion {
    completion(@{}, nil);
}

- (void)cancelAll {
}

@end
`,
    'Services/UserService.h': `#import <Foundation/Foundation.h>
@class User;

@interface UserService : NSObject
+ (instancetype)shared;
- (void)loginWithName:(NSString *)name completion:(void (^)(User *user))completion;
- (void)logout;
@end
`,
    'Services/UserService.m': `#import "UserService.h"
#import "NetworkClient.h"
#import "User.h"

@interface UserService () <NetworkClientDelegate> // @service.conforms
@property (nonatomic, strong) NetworkClient *client;
@property (nonatomic, strong) User *currentUser;
@end

@implementation UserService

+ (instancetype)shared {
    static UserService *service;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        service = [[UserService alloc] init];
    });
    return service;
}

- (instancetype)init {
    self = [super init]; // @service.superInit
    if (self) {
        _client = [NetworkClient sharedClient]; // @service.sharedClient
    }
    return self;
}

- (void)loginWithName:(NSString *)name completion:(void (^)(User *user))completion {
    User *user = [[User alloc] initWithName:name age:20]; // @service.userInit
    self.currentUser = user;
    [self trackLogin:user]; // @service.trackLogin
    completion(user);
}

- (void)trackLogin:(User *)user {
    if ([user isAdult]) { // @service.isAdult
        NSLog(@"adult");
    }
}

- (void)logout {
    self.currentUser = [User guestUser]; // @service.guestUser
}

- (void)networkClient:(NetworkClient *)client didFailWithError:(NSError *)error {
    [self logout]; // @service.selfLogout
}

@end
`,
    'Controllers/LoginViewController.h': `#import <UIKit/UIKit.h>

@interface LoginViewController : UIViewController
@end
`,
    'Controllers/LoginViewController.m': `#import "LoginViewController.h"
#import "UserService.h"
#import "User.h"

@implementation LoginViewController

- (void)viewDidLoad {
    [super viewDidLoad]; // @login.superViewDidLoad
    [self setupViews]; // @login.setupViews
}

- (void)setupViews {
}

- (void)onLoginTapped:(id)sender {
    UserService *service = [UserService shared]; // @login.shared
    [service loginWithName:@"name" completion:^(User *user) { // @login.loginWithName
        [service logout]; // @login.logout
    }];
}

@end
`,
  },
  expected: [
    {
      kind: 'calls',
      at: 'user.validate',
      toFile: 'Models/User.m',
      toSymbol: 'User.validate',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'user.guestInit',
      toFile: 'Models/User.m',
      toSymbol: 'User.initWithName:age:',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'category.trimmed',
      toFile: 'Categories/NSString+Validation.m',
      toSymbol: 'NSString.trimmed',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'network.buildURL',
      toFile: 'Services/NetworkClient.m',
      toSymbol: 'BuildURL',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'network.perform',
      toFile: 'Services/NetworkClient.m',
      toSymbol: 'NetworkClient.performRequestWithURL:completion:',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'service.sharedClient',
      toFile: 'Services/NetworkClient.m',
      toSymbol: 'NetworkClient.sharedClient',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'service.userInit',
      toFile: 'Models/User.m',
      toSymbol: 'User.initWithName:age:',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'service.trackLogin',
      toFile: 'Services/UserService.m',
      toSymbol: 'UserService.trackLogin:',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'service.isAdult',
      toFile: 'Models/User.m',
      toSymbol: 'User.isAdult',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'service.guestUser',
      toFile: 'Models/User.m',
      toSymbol: 'User.guestUser',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'service.selfLogout',
      toFile: 'Services/UserService.m',
      toSymbol: 'UserService.logout',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'login.setupViews',
      toFile: 'Controllers/LoginViewController.m',
      toSymbol: 'LoginViewController.setupViews',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'login.shared',
      toFile: 'Services/UserService.m',
      toSymbol: 'UserService.shared',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'login.loginWithName',
      toFile: 'Services/UserService.m',
      toSymbol: 'UserService.loginWithName:completion:',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'login.logout',
      toFile: 'Services/UserService.m',
      toSymbol: 'UserService.logout',
      via: 'external',
    },
    {
      kind: 'implements',
      at: 'service.conforms',
      toFile: 'Services/NetworkClient.h',
      toSymbol: 'NetworkClientDelegate',
      via: 'external',
    },
  ],
  mustNot: [
    { at: 'user.superInit', reason: '[super init] 的接收者是 NSObject，不是项目里的 init' },
    { at: 'service.superInit', reason: '[super init] 的接收者是 NSObject，不能回指自身的 init' },
    {
      at: 'login.superViewDidLoad',
      reason: '[super viewDidLoad] 的接收者是 UIViewController，不能回指自身',
    },
    { at: 'category.length', reason: 'NSString.length 是系统方法' },
    { at: 'network.format', reason: 'NSString stringWithFormat: 是系统方法' },
    { at: 'user.log', reason: 'NSLog 是系统函数' },
  ],
};

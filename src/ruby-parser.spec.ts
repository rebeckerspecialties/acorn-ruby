import { Parser, tokenize } from './ruby-parser.ts';
// this file includes inline ruby code with 'useless' escapes from JS' perspective on purpose
// eslint-disable no-useless-escape
describe('ruby-parser', () => {
    it('should parse a simple file', () => {
        const result = new Parser(
            tokenize(`
            gem 'rails'
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([
            {
                groups: [],
                name: 'rails',
                platforms: [],
                versions: [],
            },
        ]);
        expect(result.groups.development).toEqual([]);
    });

    it('extract runtime dependencies within a target (Podfile)', () => {
        const result = new Parser(
            tokenize(`
platform :ios, '11.0'

target 'HelloCocoaPods' do
    pod 'Filament'
end
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([
            {
                groups: ['HelloCocoaPods'],
                name: 'Filament',
                platforms: [],
                versions: [],
            },
        ]);
        expect(result.groups.development).toEqual([]);
    });

    it('extracts multiple versions in word array (gemspec)', () => {
        const result = new Parser(
            tokenize(`Gem::Specification.new do |s|
s.add_runtime_dependency 'foo', %w[~>1.0 >=1.5]
end
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([
            {
                groups: [],
                name: 'foo',
                platforms: [],
                versions: ['~> 1.0', '>= 1.5'],
            },
        ]);
        expect(result.groups.development).toEqual([]);
    });

    it('extracts name from %q literal (gemspec)', () => {
        const result = new Parser(
            tokenize(`Gem::Specification.new do |s|
            s.add_runtime_dependency %q{foo}, '~>2.0'
        end
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([
            {
                groups: [],
                name: 'foo',
                platforms: [],
                versions: ['~> 2.0'],
            },
        ]);
        expect(result.groups.development).toEqual([]);
    });

    it('understands platforms and inline group', () => {
        const result = new Parser(
            tokenize(`
gem 'byebug', platforms: [:mri, :cygwin, :arm64], group: development
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([]);
        expect(result.groups.development).toEqual([
            {
                name: 'byebug',
                platforms: ['mri', 'cygwin', 'arm64'],
                versions: [],
            },
        ]);
    });

    it('understands multiple groups', () => {
        const result = new Parser(
            tokenize(`
group :test, :development do
    gem 'bar', '2.0'
end
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([]);
        expect(result.groups.development).toEqual([
            {
                name: 'bar',
                platforms: [],
                versions: ['2.0'],
            },
        ]);
    });

    it('understands legacy add_dependency', () => {
        const result = new Parser(
            tokenize(`
Gem::Specification.new do |s|
  s.add_dependency 'rails', '~> 6.1.0'
  s.add_dependency 'nokogiri'
  s.add_development_dependency 'rspec', '~> 3.0'
end
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([
            {
                groups: [],
                name: 'rails',
                platforms: [],
                versions: ['~> 6.1.0'],
            },
            {
                groups: [],
                name: 'nokogiri',
                platforms: [],
                versions: [],
            },
        ]);
        expect(result.groups.development).toEqual([
            {
                groups: [],
                name: 'rspec',
                platforms: [],
                versions: ['~> 3.0'],
            },
        ]);
    });

    it('understands trailing conditionals', () => {
        const result = new Parser(
            tokenize(`
"DB" ||= "dbase"
gem "couchdb", "0.2.2" if ENV["DB"] == "all" || ENV["DB"] == "couch"
gem "dbf", "5.0.1" if ENV["DB"] == "dbase"
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([
            {
                name: 'couchdb',
                platforms: [],
                versions: ['0.2.2'],
            },
            {
                name: 'dbf',
                platforms: [],
                versions: ['5.0.1'],
            },
        ]);
    });

    it('protobuf podspec', () => {
        const result = new Parser(
            tokenize(`
Pod::Spec.new do |s|
  s.name     = 'Protobuf'
  s.version  = '4.31.0'
  s.summary  = 'Protocol Buffers v.3 runtime library for Objective-C.'
  s.homepage = 'https://github.com/protocolbuffers/protobuf'
  s.license  = 'BSD-3-Clause'
  s.authors  = { 'The Protocol Buffers contributors' => 'protobuf@googlegroups.com' }

  # Ensure developers won't hit CocoaPods/CocoaPods#11402 with the resource
  # bundle for the privacy manifest.
  s.cocoapods_version = '>= 1.12.0'

  s.source = { :git => 'https://github.com/protocolbuffers/protobuf.git',
               :tag => "v#{s.version}" }

  s.source_files = 'objectivec/*.{h,m,swift}'
  # The following would cause duplicate symbol definitions. GPBProtocolBuffers is expected to be
  # left out, as it's an umbrella implementation file.
  s.exclude_files = 'objectivec/GPBProtocolBuffers.m'

  # Now that there is a Swift source file, set a version.
  s.swift_version = '5.0'

  s.resource_bundle = {
    "Protobuf_Privacy" => "PrivacyInfo.xcprivacy"
  }

  # Set a CPP symbol so the code knows to use framework imports.
  s.user_target_xcconfig = { 'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) GPB_USE_PROTOBUF_FRAMEWORK_IMPORTS=1' }
  s.pod_target_xcconfig = { 'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) GPB_USE_PROTOBUF_FRAMEWORK_IMPORTS=1' }

  s.ios.deployment_target = '15.0'
  s.osx.deployment_target = '11.0'
  # The following are best-effort / community supported, and are not covered by
  # our official support policies: https://protobuf.dev/support/version-support/
  s.tvos.deployment_target = '12.0'
  s.watchos.deployment_target = '6.0'
  s.visionos.deployment_target = '1.0'
  s.requires_arc = false

  # seem that great at the moment, so the tests have *not* been wired into here
  # at this time.
end
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([]);
        expect(result.groups.development).toEqual([]);
    });

    xit('japenese gemspec', () => {
        const result = new Parser(
            tokenize(`
# -*- r -*-
_VERSION = "1.2.9"
date = %w$Date::                           $[1]
Gem::Specification.new do |xyz|
  xyz.name = "bd"
  xyz.version = _VERSION
  xyz.date = date
  xyz.summary = "Superkalifrajilistic.\n"
  xyz.homepage = "http://www.ruby-lang.org"
  xyz.email = "foo@coin.jp"
  xyz.description = "SKULLS SKULLS SKULLS"
  xyz.authors = ["K", "X", "O"]
  xyz.require_path = %[%].
  xyz.files = %w[
    bd.gemspec
    bd.c
    bd.h
    README
    depend extconf.rb
    lib/bd/jac.rb
    sample/i.rb
  ]
  xyz.extensions = %w[extconf.rb]
end
        `)
        ).parse();
        expect(result.groups.runtime).toEqual([
            {
                groups: [],
                name: 'bd',
                platforms: [],
                versions: ['1.2.9'],
            },
        ]);
        expect(result.groups.development).toEqual([]);
    });

    it('folly podspec', () => {
        const result = new Parser(
            tokenize(`
# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

Pod::Spec.new do |spec|
  spec.name = 'Flipper-Folly'
  spec.version = '2.6.10'
  spec.license = { :type => 'Apache License, Version 2.0' }
  spec.homepage = 'https://github.com/facebook/folly'
  spec.summary = 'An open-source C++ library developed and used at Facebook.'
  spec.authors = 'Facebook'
  spec.source = { :git => 'https://github.com/facebook/folly.git',
                  :tag => "v2021.06.14.00"}
  spec.module_name = 'folly'
  spec.dependency 'Flipper-Boost-iOSX'
  spec.dependency 'Flipper-Glog'
  spec.dependency 'Flipper-DoubleConversion'
  spec.dependency 'OpenSSL-Universal', '1.1.1100'
  spec.dependency 'libevent', '~> 2.1.12'
  spec.dependency 'Flipper-Fmt', '7.1.7'
  spec.compiler_flags = '-DFOLLY_HAVE_BACKTRACE=1 -DFOLLY_HAVE_CLOCK_GETTIME=1 -DFOLLY_HAVE_PTHREAD=1 -DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1 -DFOLLY_HAVE_LIBGFLAGS=0 -DFOLLY_HAVE_LIBJEMALLOC=0 -DFOLLY_HAVE_PREADV=0 -DFOLLY_HAVE_PWRITEV=0 -DFOLLY_HAVE_TFO=0
    -frtti
    -fexceptions
    -std=c++14
    -Wno-error
    -Wno-unused-local-typedefs
    -Wno-global-constructors
    -Wno-comma'

  spec.source_files = "folly/*.h",
                      "folly/concurrency/*.h",
                      "folly/container/*.h",
                      "folly/container/*.cpp",
                      "folly/container/detail/*.h",
                      "folly/detail/*.h",
                      "folly/executors/**/*.h",
                      "folly/experimental/*.h",
                      "folly/functional/*.h",
                      "folly/futures/*.h",
                      "folly/futures/detail/*.h",
                      "folly/gen/*.h",
                      "folly/hash/*.h",
                      "folly/hash/detail/*.h",
                      "folly/init/*.h",
                      "folly/io/*.h",
                      "folly/io/async/*.h",
                      "folly/io/async/ssl/*.h",
                      "folly/lang/*.h",
                      "folly/memory/*.h",
                      "folly/memory/detail/*.h",
                      "folly/net/*.h",
                      "folly/net/detail/*.h",
                      "folly/ssl/*.h",
                      "folly/ssl/detail/*.h",
                      "folly/synchronization/*.h",
                      "folly/synchronization/detail/*.h",
                      "folly/synchronization/detail/*.cpp",
                      "folly/system/*.h",
                      "folly/tracing/*.h",
                      "folly/tracing/*.cpp",
                      "folly/chrono/*.h",
                      "folly/chrono/*.cpp",
                      "folly/*.cpp",
                      "folly/concurrency/*.cpp",
                      "folly/container/detail/*.cpp",
                      "folly/detail/*.cpp",
                      "folly/executors/*.cpp",
                      "folly/experimental/hazptr/*.cpp",
                      "folly/futures/*.cpp",
                      "folly/futures/detail/*.cpp",
                      "folly/hash/*.cpp",
                      "folly/io/*.cpp",
                      "folly/io/async/*.cpp",
                      "folly/io/async/ssl/*.cpp",
                      "folly/lang/*.cpp",
                      "folly/memory/*.cpp",
                      "folly/memory/detail/*.cpp",
                      "folly/net/*.cpp",
                      "folly/ssl/*.cpp",
                      "folly/ssl/detail/*.cpp",
                      "folly/String.cpp",
                      "folly/synchronization/*.cpp",
                      "folly/system/*.cpp",
                      "folly/experimental/coro/*.h",
                      "folly/experimental/symbolizer/*.h",
                      "folly/experimental/symbolizer/*.cpp",
                      "folly/fibers/*.h",
                      "folly/fibers/*.cpp",
                      "folly/experimental/symbolizer/detail/*.h",
                      "folly/experimental/symbolizer/detail/*.cpp",
                      "folly/logging/*.h",
                      "folly/logging/*.cpp",
                      "folly/experimental/coro/detail/*.h",
                      "folly/experimental/coro/detail/*.cpp",
                      "folly/portability/Unistd.h",
                      "folly/portability/Unistd.cpp",
                      "folly/portability/Sched.cpp",
                      "folly/experimental/observer/detail/*.h",
                      "folly/experimental/observer/detail/*.cpp",

  spec.exclude_files = "folly/synchronization/Rcu.cpp", "folly/synchronization/Rcu.h"
  spec.header_mappings_dir = 'folly'
  spec.header_dir          = 'folly'
  spec.libraries           = "stdc++", "c++abi"

  spec.public_header_files =  "folly/**/*.h"

  spec.pod_target_xcconfig = {  "USE_HEADERMAP" => "NO",
                                "CLANG_CXX_LANGUAGE_STANDARD" => "c++14",
                                "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/Flipper-Boost-iOSX\" \"$(PODS_ROOT)/Flipper-DoubleConversion\" \"$(PODS_ROOT)/libevent/include\""
                              }
  spec.platforms = { :ios => "10.0"}
end
        `)
        ).parse();
        // Dependencies can be in any order
        expect(result.groups.runtime).toHaveLength(6);
        const deps = result.groups.runtime.reduce((acc, dep) => {
            acc[dep.name] = dep;
            return acc;
        }, {});

        expect(deps['Flipper-Boost-iOSX']).toEqual({
            name: 'Flipper-Boost-iOSX',
            platforms: [],
            versions: [],
        });
        expect(deps['Flipper-Glog']).toEqual({
            name: 'Flipper-Glog',
            platforms: [],
            versions: [],
        });
        expect(deps['Flipper-DoubleConversion']).toEqual({
            name: 'Flipper-DoubleConversion',
            platforms: [],
            versions: [],
        });
        expect(deps['OpenSSL-Universal']).toEqual({
            name: 'OpenSSL-Universal',
            platforms: [],
            versions: ['1.1.1100'],
        });
        expect(deps['libevent']).toEqual({
            name: 'libevent',
            platforms: [],
            versions: ['~> 2.1.12'],
        });
        expect(deps['Flipper-Fmt']).toEqual({
            name: 'Flipper-Fmt',
            platforms: [],
            versions: ['7.1.7'],
        });

        expect(result.groups.development).toEqual([]);
    });

    it('complex gemfile with comments, conditionals, and groups', () => {
        const result = new Parser(
            tokenize(`
source "https://rubygems.org"
gem "rails", "5.0.1"
# [[comment]]
# \\conditional\\
ENV["DB"] ||= "dbase"
gem "couchdb", "0.2.2" if ENV["DB"] == "all" || ENV["DB"] == "couch"
gem "dbf", "5.0.1" if ENV["DB"] == "dbase"

gem "responders", "3.1.1", require: true
gem "unicorn", "6.0.0", require: false
gem "diaspora_federation-rails", "1.1.0"
group :production do
  gem "minitest"
end
        `)
        ).parse();

        // Should detect these as runtime dependencies
        const expectedRuntime = [
            'couchdb',
            'rails',
            'responders',
            'unicorn',
            'diaspora_federation-rails',
            'dbf',
            'minitest',
        ];
        const actualRuntimeNames = result.groups.runtime
            .map((d) => d.name)
            .sort();

        expect(actualRuntimeNames).toEqual(expectedRuntime.sort());

        // Verify specific dependencies
        const deps = result.groups.runtime.reduce((acc, dep) => {
            acc[dep.name] = dep;
            return acc;
        }, {});

        expect(deps['rails'].versions).toEqual(['5.0.1']);
        expect(deps['responders'].versions).toEqual(['3.1.1']);
        expect(deps['unicorn'].versions).toEqual(['6.0.0']);
        expect(deps['diaspora_federation-rails'].versions).toEqual(['1.1.0']);
        expect(deps['couchdb'].versions).toEqual(['0.2.2']);
        expect(deps['dbf'].versions).toEqual(['5.0.1']);
        expect(deps['minitest'].versions).toEqual([]);

        expect(result.groups.development).toEqual([]);
    });

    it('handles if/else blocks with no trailing dependency, .freeze, and array version specs', () => {
        const result = new Parser(
            tokenize(`
# coding: utf-16
lib = File.expand_path('../lib', __FILE__)
$LOAD_PATH.unshift(lib) unless $LOAD_PATH.include?(lib)
require 'rubocop/select/version'
Gem::Specification.new do |l_op|
  if l_op.respond_to? :add_runtime_dependency then
    l_op.add_runtime_dependency %q<power_assert>.freeze, [">= 1"]
    l_op.add_development_dependency(%q<bundler>.freeze, [">= 2"])
  else
    l_op.add_dependency(%q<power_assert_old>.freeze, [">= 1"])
    l_op.add_dependency %q<bundler_old>.freeze, [">= 2"]
  end
end
        `)
        ).parse();

        // Should only process first branch of if/else
        expect(result.groups.runtime).toEqual([
            {
                groups: [],
                name: 'power_assert',
                platforms: [],
                versions: ['>= 1'],
            },
        ]);

        expect(result.groups.development).toEqual([
            {
                groups: [],
                name: 'bundler',
                platforms: [],
                versions: ['>= 2'],
            },
        ]);
    });

    it('handles if/else blocks with trailing dependency', () => {
        const result = new Parser(
            tokenize(`
Gem::Specification.new do |l_op|
  if l_op.respond_to? :add_runtime_dependency then
    l_op.add_runtime_dependency("power_assert", ">= 1")
  else
    l_op.add_dependency("power_assert_old", ">= 1")
  end
end
gem 'rspec'
        `)
        ).parse();

        // Should only process first branch of if/else
        expect(result.groups.runtime).toEqual([
            {
                groups: [],
                name: 'power_assert',
                platforms: [],
                versions: ['>= 1'],
            },
            {
                groups: [],
                name: 'rspec',
                platforms: [],
                versions: [],
            },
        ]);

        expect(result.groups.development).toEqual([]);
    });

    it('handles complex quoting and spacing edge cases', () => {
        const result = new Parser(
            tokenize(`
Gem::Specification.new do |s|
  # Complex quoted strings with extra quotes/spaces
  s.add_dependency '""rails""', "'>= 6.0'"
  s.add_dependency %q{'''nokogiri'''}, %w[  ~>1.0   >=1.5  ]
  s.add_dependency :"sym::bol", [" >= 2.0 "]
  s.add_dependency %q<gemname>, %q<3.0>
end
      `)
        ).parse();

        expect(result.groups.runtime).toEqual([
            {
                groups: [],
                name: 'rails',
                platforms: [],
                versions: ['>= 6.0'],
            },
            {
                groups: [],
                name: 'nokogiri',
                platforms: [],
                versions: ['~> 1.0', '>= 1.5'],
            },
            {
                groups: [],
                name: 'sym::bol',
                platforms: [],
                versions: ['>= 2.0'],
            },
            {
                groups: [],
                name: 'gemname',
                platforms: [],
                versions: ['3.0'],
            },
        ]);
    });
});

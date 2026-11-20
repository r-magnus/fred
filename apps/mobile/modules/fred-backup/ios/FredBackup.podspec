Pod::Spec.new do |s|
  s.name           = 'FredBackup'
  s.version        = '0.1.0'
  s.summary        = "Keeps Fred's downloads out of the iPhone's iCloud backup"
  s.description    = "Marks downloaded guides, models and maps as excluded from backup; they can be downloaded again."
  s.license        = 'MIT'
  s.author         = 'Fred'
  s.homepage       = 'https://github.com/r-magnus/fred'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/r-magnus/fred.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end

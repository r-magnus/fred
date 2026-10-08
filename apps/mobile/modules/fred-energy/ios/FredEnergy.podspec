Pod::Spec.new do |s|
  s.name           = 'FredEnergy'
  s.version        = '0.1.0'
  s.summary        = "The phone's own energy readings for Fred's battery estimate"
  s.description    = "Battery level and the app's own processor energy counter, for the estimate shown before a question is sent."
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

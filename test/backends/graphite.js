/*jshint node:true, mocha: true */
'use strict';


var net = require('net');
var events = require('events');
var util = require('util');

var graphiteConfig = {
  graphService: 'graphite',
  batch: 200 ,
  flushInterval: 200 ,
  percentThreshold: 90,
  histogram: [ { metric: 'a_test_value', bins: [1000] } ],
  port: 8125,
  dumpMessages: false ,
  debug: false,
  graphite: { legacyNamespace: false },
  graphitePort: 12345,
  graphiteHost: '127.0.0.1',
  prefixStats: 'prefix'
};

function setupGraphite(test, onEnd, onListen) {
  test.graphiteServer = net.createServer();
  test.graphiteServer.on('connection', function(stream) {
    var body = '';
    stream.on('data', function(data) {
      body += data;
    });
    stream.on('end', function() {
      onEnd(body);
    });
  });
  test.graphiteServer.listen(12345, onListen);
}

function parseGraphiteInput(input) {
  var dict = {};
  var lines = input.split('\n');
  for(var i in lines) {
    var splitted = lines[i].split(' ');
    dict[splitted[0]] = splitted[1];
  }
  return dict;
}


function sendToGraphiteBackend(startupTime, time_stamp, metrics) {
  return function(done) {
      var test = this;

      setupGraphite(this, function(body) {
        test.rawbody = body;
        test.body = parseGraphiteInput(body);
        done();
      }, function() {
        var emitter = new events.EventEmitter();
        var logger = {};
        require('../../backends/graphite').init(startupTime, graphiteConfig, emitter, logger);
        emitter.emit('flush', time_stamp, metrics);
      });
    };
}

function loadGraphiteStatus(startupTime, time_stamp, metrics) {
  return function(done) {
    var test = this;

    setupGraphite(this,
      function(body) {},
      function() {
        var emitter = new events.EventEmitter();
        var logger = {};
        require('../../backends/graphite').init(startupTime, graphiteConfig, emitter, logger);
        emitter.emit('flush', time_stamp, metrics);

        setTimeout(function() {
          emitter.emit('flush', time_stamp, metrics);

          var metricNumber =  4;
          test.status = {}
          emitter.emit('status', function(err, backend, metric, value) {
            metricNumber--;
            test.status[backend] = test.status[backend] || {};
            test.status[backend][metric] = value;
            if (metricNumber <= 0) {
              done();
            }
          });
        }, 200);
    });
  }
}

function tearDownGraphite(done) {
  /*jshint validthis:true */
  this.graphiteServer.on('close', done);
  this.graphiteServer.close();
}

function removeUtilLog(done) {
  /*jshint validthis:true */
  this.oldUtilLog = util.log;
  util.log = function() {};
  done();
}
function reserUtilLog(done) {
  /*jshint validthis:true */
  util.log = this.oldUtilLog;
  done();
}


var assert = require('assert');
describe('send', function() {
  var startupTime = Math.round(+new Date()/1000) - 200;
  var time_stamp = Math.round(+new Date()/1000);
  beforeEach(removeUtilLog);
  afterEach(reserUtilLog);

  describe('bad lines', function() {
    var badMetrics = {
      counters: { 'statsd.bad_lines_seen': 1, 'statsd.packets_received': 1 },
      gauges: { 'statsd.timestamp_lag': -0.2 },
      timers: {},
      timer_counters: {},
      sets: {},
      counter_rates: { 'statsd.bad_lines_seen': 5, 'statsd.packets_received': 5 },
      timer_data: {},
      pctThreshold: [ 90 ],
      histogram: [ { metric: 'a_test_value', bins: [ 1000 ] } ],
      statsd_metrics: { processing_time: 0 }
    };

    before(sendToGraphiteBackend(startupTime, time_stamp, badMetrics));
    after(tearDownGraphite);

    it('rate', function() {
      assert.equal(5, this.body['stats.counters.statsd.bad_lines_seen.rate']);
    });
    it('count', function() {
      assert.equal(1, this.body['stats.counters.statsd.bad_lines_seen.count']);
    });
    it('timestamp', function() {
      var splitted = this.rawbody.split('\n');
      splitted.pop();
      for(var i in splitted) {
        assert.ok(!!splitted[i].match(time_stamp + '$'), 'Different timestamp ' + splitted[i]);
      }
    });
    it('numStats', function() {
      assert.equal(3, this.body['stats.prefix.numStats']);
    });
  });

  describe('timers', function() {
    var metrics = {
      counters: { 'statsd.bad_lines_seen': 0, 'statsd.packets_received': 1 },
      gauges: { 'statsd.timestamp_lag': -0.2 },
      timers: { a_test_value: [ 100 ] },
      timer_counters: { a_test_value: 1 },
      sets: {},
      counter_rates: { 'statsd.bad_lines_seen': 0, 'statsd.packets_received': 5 },
      timer_data: {
        a_test_value: {
          count_90: 1,
          mean_90: 100,
          upper_90: 100,
          sum_90: 100,
          sum_squares_90: 10000,
          std: 0,
          upper: 100,
          lower: 100,
          count: 1,
          count_ps: 5,
          sum: 100,
          sum_squares: 10000,
          mean: 100,
          median: 100,
          histogram: { bin_1000: 1 }
        }
      },
      pctThreshold: [ 90 ],
      histogram: [ { metric: 'a_test_value', bins: [ 1000 ] } ],
      statsd_metrics: { processing_time: 1 }
    };

    before(sendToGraphiteBackend(startupTime, time_stamp, metrics));
    after(tearDownGraphite);

    it('bad lines rate', function() {
      assert.equal(0, this.body['stats.counters.statsd.bad_lines_seen.rate']);
    });
    it('bad lines count', function() {
      assert.equal(0, this.body['stats.counters.statsd.bad_lines_seen.count']);
    });
    it('package received rate', function() {
      assert.equal(5, this.body['stats.counters.statsd.packets_received.rate']);
    });
    it('package received count', function() {
      assert.equal(1, this.body['stats.counters.statsd.packets_received.count']);
    });
    it('count_90', function() {
      assert.equal(1, this.body['stats.timers.a_test_value.count_90']);
    });
    it('mean_90', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.mean_90']);
    });
    it('upper_90', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.upper_90']);
    });
    it('sum_90', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.sum_90']);
    });
    it('sum_squares_90', function() {
      assert.equal(10000, this.body['stats.timers.a_test_value.sum_squares_90']);
    });
    it('std', function() {
      assert.equal(0, this.body['stats.timers.a_test_value.std']);
    });
    it('upper', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.upper']);
    });
    it('lower', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.lower']);
    });
    it('count', function() {
      assert.equal(1, this.body['stats.timers.a_test_value.count']);
    });
    it('count_ps', function() {
      assert.equal(5, this.body['stats.timers.a_test_value.count_ps']);
    });
    it('sum', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.sum']);
    });
    it('sum_squares', function() {
      assert.equal(10000, this.body['stats.timers.a_test_value.sum_squares']);
    });
    it('mean', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.mean']);
    });
    it('median', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.median']);
    });
    it('histogram.bin_1000', function() {
      assert.equal(1, this.body['stats.timers.a_test_value.histogram.bin_1000']);
    });
  });

  describe('sample timer', function() {
    var metrics = {
      sets: {},
      counter_rates: { 'statsd.bad_lines_seen': 0, 'statsd.packets_received': 5 },
      timer_data: {
        a_test_value: {
          count_90: 1,
          mean_90: 100,
          upper_90: 100,
          sum_90: 100,
          sum_squares_90: 10000,
          std: 0,
          upper: 100,
          lower: 100,
          count: 10,
          count_ps: 50,
          sum: 100,
          sum_squares: 10000,
          mean: 100,
          median: 100,
          histogram: { bin_1000: 1 }
        }
      },
      pctThreshold: [ 90 ],
      histogram: [ { metric: 'a_test_value', bins: [ 1000 ] } ],
      statsd_metrics: { processing_time: 1 }
    };

    before(sendToGraphiteBackend(startupTime, time_stamp, metrics));
    after(tearDownGraphite);

    it('count_90', function() {
      assert.equal(1, this.body['stats.timers.a_test_value.count_90']);
    });
    it('mean_90', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.mean_90']);
    });
    it('upper_90', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.upper_90']);
    });
    it('sum_90', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.sum_90']);
    });
    it('sum_squares_90', function() {
      assert.equal(10000, this.body['stats.timers.a_test_value.sum_squares_90']);
    });
    it('std', function() {
      assert.equal(0, this.body['stats.timers.a_test_value.std']);
    });
    it('upper', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.upper']);
    });
    it('lower', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.lower']);
    });
    it('count', function() {
      assert.equal(10, this.body['stats.timers.a_test_value.count']);
    });
    it('count_ps', function() {
      assert.equal(50, this.body['stats.timers.a_test_value.count_ps']);
    });
    it('sum', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.sum']);
    });
    it('sum_squares', function() {
      assert.equal(10000, this.body['stats.timers.a_test_value.sum_squares']);
    });
    it('mean', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.mean']);
    });
    it('median', function() {
      assert.equal(100, this.body['stats.timers.a_test_value.median']);
    });
    it('histogram.bin_1000', function() {
      assert.equal(1, this.body['stats.timers.a_test_value.histogram.bin_1000']);
    });
  });

  describe('counts', function() {
    var metrics = {
      counters: {
        'statsd.bad_lines_seen': 0,
        'statsd.packets_received': 1,
        a_test_value: 100
      },
      gauges: { 'statsd.timestamp_lag': -0.2 },
      timers: {},
      timer_counters: {},
      sets: {},
      counter_rates: {
        'statsd.bad_lines_seen': 0,
        'statsd.packets_received': 5,
        a_test_value: 500
      },
      timer_data: {},
      pctThreshold: [ 90 ],
      histogram: [ { metric: 'a_test_value', bins: [ 1000 ] } ],
      statsd_metrics: { processing_time: 0 }
    };

    before(sendToGraphiteBackend(startupTime, time_stamp, metrics));
    after(tearDownGraphite);

    it('bad_lines_seen rate', function() {
      assert.equal(0, this.body['stats.counters.statsd.bad_lines_seen.rate']);
    });
    it('bad_lines_seen count', function() {
      assert.equal(0, this.body['stats.counters.statsd.bad_lines_seen.count']);
    });
    it('packets_received.rate', function() {
      assert.equal(5, this.body['stats.counters.statsd.packets_received.rate']);
    });
    it('packets_received.count', function() {
      assert.equal(1, this.body['stats.counters.statsd.packets_received.count']);
    });
    it('rate', function() {
      assert.equal(500, this.body['stats.counters.a_test_value.rate']);
    });
    it('count', function() {
      assert.equal(100, this.body['stats.counters.a_test_value.count']);
    });
    it('numStats', function() {
      assert.equal(4, this.body['stats.prefix.numStats']);
    });
  });

  describe('gauges', function() {
    var metrics = {
      counters: { 'statsd.bad_lines_seen': 0, 'statsd.packets_received': 1 },
      gauges: { a_test_value: 70, 'statsd.timestamp_lag': -0.2 },
      timers: {},
      timer_counters: {},
      sets: {},
      counter_rates: { 'statsd.bad_lines_seen': 0, 'statsd.packets_received': 5 },
      timer_data: {},
      pctThreshold: [ 90 ],
      histogram: [ { metric: 'a_test_value', bins: [ 1000 ] } ],
      statsd_metrics: { processing_time: 0 }
    };

    before(sendToGraphiteBackend(startupTime, time_stamp, metrics));
    after(tearDownGraphite);

    it('bad_lines_seen.rate', function() {
      assert.equal(0, this.body['stats.counters.statsd.bad_lines_seen.rate']);
    });
    it('bad_lines_seen.count', function() {
      assert.equal(0, this.body['stats.counters.statsd.bad_lines_seen.count']);
    });
    it('packets_received.rate', function() {
      assert.equal(5, this.body['stats.counters.statsd.packets_received.rate']);
    });
    it('packets_received.count', function() {
      assert.equal(1, this.body['stats.counters.statsd.packets_received.count']);
    });
    it('a_test_value', function() {
      assert.equal(70, this.body['stats.gauges.a_test_value']);
    });
    it('timestamp_lag', function() {
      assert.equal(-0.2, this.body['stats.gauges.statsd.timestamp_lag']);
    });
    it('numStats', function() {
      assert.equal(4, this.body['stats.prefix.numStats']);
    });
  });
});


describe('status', function() {
  var metrics = {
      counters: { 'statsd.bad_lines_seen': 0, 'statsd.packets_received': 1 },
      gauges: { 'statsd.timestamp_lag': -0.2 },
      timers: { a_test_value: [ 100 ] },
      timer_counters: { a_test_value: 1 },
      sets: {},
      counter_rates: { 'statsd.bad_lines_seen': 0, 'statsd.packets_received': 5 },
      timer_data: {
        a_test_value: {
          count_90: 1,
          mean_90: 100,
          upper_90: 100,
          sum_90: 100,
          sum_squares_90: 10000,
          std: 0,
          upper: 100,
          lower: 100,
          count: 1,
          count_ps: 5,
          sum: 100,
          sum_squares: 10000,
          mean: 100,
          median: 100,
          histogram: { bin_1000: 1 }
        }
      },
      pctThreshold: [ 90 ],
      histogram: [ { metric: 'a_test_value', bins: [ 1000 ] } ],
      statsd_metrics: { processing_time: 1 }
    };

  var startupTime = Math.round(+new Date()/1000) - 200;
  var time_stamp = Math.round(+new Date()/1000);

    before(loadGraphiteStatus(startupTime, time_stamp, metrics));
    after(tearDownGraphite);

    it('check graphite', function() {
      assert.ok('graphite' in this.status);
    })
})
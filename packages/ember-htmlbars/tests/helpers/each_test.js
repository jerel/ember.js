/*jshint newcap:false*/
import Ember from 'ember-metal/core'; // Ember.lookup;
import EmberObject from 'ember-runtime/system/object';
import run from 'ember-metal/run_loop';
import EmberView from 'ember-views/views/view';
import LegacyEachView from 'ember-views/views/legacy_each_view';
import { A } from 'ember-runtime/system/native_array';
import EmberController from 'ember-runtime/controllers/controller';
import { Registry } from 'ember-runtime/system/container';

import { set } from 'ember-metal/property_set';
import { runAppend, runDestroy } from 'ember-runtime/tests/utils';

import compile from 'ember-template-compiler/system/compile';
import { deprecation as eachDeprecation } from 'ember-htmlbars/helpers/each';

import { registerAstPlugin, removeAstPlugin } from 'ember-htmlbars/tests/utils';
import TransformEachIntoCollection from 'ember-template-compiler/plugins/transform-each-into-collection';


var people, view, registry, container;
var template, templateMyView, MyView, MyEmptyView, templateMyEmptyView;

// This function lets us write {{#EACH|people|p}} {{p}} {{/each}}
// and generate:
//
// - {{#each p in people}} (legacy)
// - {{#each people as |p|}} (legacy)
function makeReplacer(useBlockParams) {
  return function(_, matchString) {
    var values = matchString.split('|');
    if (values.length === 1) { return 'each'; }

    var arr = useBlockParams ?
      ['each', values[1], 'as', '|' + values[2] + '|'] :
      ['each', values[2], 'in', values[1]];

    var options = values[3];
    if (options) {
      if (useBlockParams) {
        arr.splice(2, 0, options);
      } else {
        arr.push(options);
      }
    }

    return arr.join(' ');
  };
}

var parseEachReplacerBlockParam    = makeReplacer(true);
var parseEachReplacerNonBlockParam = makeReplacer(false);

var EACH_REGEX = /(EACH[^\}]*)/g;

function parseEach(str, useBlockParams) {
  return str.replace(EACH_REGEX, useBlockParams ? parseEachReplacerBlockParam : parseEachReplacerNonBlockParam);
}

QUnit.module('parseEach test helper');

QUnit.test('block param syntax substitution', function() {
  equal(parseEach('{{#EACH|people|p}}p people{{/EACH}}', true), '{{#each people as |p|}}p people{{/each}}');
  equal(parseEach('{{#EACH|people|p|a=\'b\' c=\'d\'}}p people{{/EACH}}', true), '{{#each people a=\'b\' c=\'d\' as |p|}}p people{{/each}}');
});

QUnit.test('non-block param syntax substitution', function() {
  equal(parseEach('{{#EACH|people|p}}p people{{/EACH}}', false), '{{#each p in people}}p people{{/each}}');
  equal(parseEach('{{#EACH|people|p|a=\'b\' c=\'d\'}}p people{{/EACH}}', false), '{{#each p in people a=\'b\' c=\'d\'}}p people{{/each}}');
});

function templateFor(templateString, useBlockParams) {
  var parsedTemplateString = parseEach(templateString, useBlockParams);
  var template;

  if (!useBlockParams) {
    expectDeprecation(/use the block param form/);
  }
  template = compile(parsedTemplateString);

  return template;
}

var originalLookup = Ember.lookup;
var lookup;

QUnit.module('the #each helper [DEPRECATED]', {
  setup() {
    Ember.lookup = lookup = { Ember: Ember };

    registerAstPlugin(TransformEachIntoCollection);

    template = compile('{{#each view.people}}{{name}}{{/each}}');
    people = A([{ name: 'Steve Holt' }, { name: 'Annabelle' }]);

    registry = new Registry();
    container = registry.container();

    registry.register('view:toplevel', EmberView.extend());
    registry.register('view:-legacy-each', LegacyEachView);

    view = EmberView.create({
      container: container,
      template: template,
      people: people
    });

    templateMyView = compile('{{name}}');
    lookup.MyView = MyView = EmberView.extend({
      template: templateMyView
    });
    registry.register('view:my-view', MyView);

    templateMyEmptyView = compile('I\'m empty');
    lookup.MyEmptyView = MyEmptyView = EmberView.extend({
      template: templateMyEmptyView
    });
    registry.register('view:my-empty-view', MyEmptyView);

    expectDeprecation(function() {
      runAppend(view);
    }, eachDeprecation);
  },

  teardown() {
    runDestroy(container);
    runDestroy(view);
    registry = container = view = null;

    Ember.lookup = originalLookup;

    removeAstPlugin(TransformEachIntoCollection);
  }
});

var assertHTML = function(view, expectedHTML) {
  var html = view.$().html();

  // IE 8 (and prior?) adds the \r\n
  html = html.replace(/<script[^>]*><\/script>/ig, '').replace(/[\r\n]/g, '');

  equal(html, expectedHTML);
};

var assertText = function(view, expectedText) {
  equal(view.$().text(), expectedText);
};

QUnit.test('it renders the template for each item in an array', function() {
  assertHTML(view, 'Steve HoltAnnabelle');
});

QUnit.test('it updates the view if an item is added', function() {
  run(function() {
    people.pushObject({ name: 'Tom Dale' });
  });

  assertHTML(view, 'Steve HoltAnnabelleTom Dale');
});

if (typeof Handlebars === 'object') {
  QUnit.test('should be able to use standard Handlebars #each helper', function() {
    runDestroy(view);

    view = EmberView.create({
      context: { items: ['a', 'b', 'c'] },
      template: Handlebars.compile('{{#each items}}{{this}}{{/each}}')
    });

    runAppend(view);

    equal(view.$().html(), 'abc');
  });
}

QUnit.test('it allows you to access the current context using {{this}}', function() {
  runDestroy(view);

  view = EmberView.create({
    template: compile('{{#each view.people}}{{this}}{{/each}}'),
    people: A(['Black Francis', 'Joey Santiago', 'Kim Deal', 'David Lovering'])
  });

  runAppend(view);

  assertHTML(view, 'Black FrancisJoey SantiagoKim DealDavid Lovering');
});

QUnit.test('it updates the view if an item is removed', function() {
  run(function() {
    people.removeAt(0);
  });

  assertHTML(view, 'Annabelle');
});

QUnit.test('it updates the view if an item is replaced', function() {
  run(function() {
    people.removeAt(0);
    people.insertAt(0, { name: 'Kazuki' });
  });

  assertHTML(view, 'KazukiAnnabelle');
});

QUnit.test('can add and replace in the same runloop', function() {
  run(function() {
    people.pushObject({ name: 'Tom Dale' });
    people.removeAt(0);
    people.insertAt(0, { name: 'Kazuki' });
  });

  assertHTML(view, 'KazukiAnnabelleTom Dale');
});

QUnit.test('can add and replace the object before the add in the same runloop', function() {
  run(function() {
    people.pushObject({ name: 'Tom Dale' });
    people.removeAt(1);
    people.insertAt(1, { name: 'Kazuki' });
  });

  assertHTML(view, 'Steve HoltKazukiTom Dale');
});

QUnit.test('can add and replace complicatedly', function() {
  run(function() {
    people.pushObject({ name: 'Tom Dale' });
    people.removeAt(1);
    people.insertAt(1, { name: 'Kazuki' });
    people.pushObject({ name: 'Firestone' });
    people.pushObject({ name: 'McMunch' });
    people.removeAt(3);
  });

  assertHTML(view, 'Steve HoltKazukiTom DaleMcMunch');
});

QUnit.test('can add and replace complicatedly harder', function() {
  run(function() {
    people.pushObject({ name: 'Tom Dale' });
    people.removeAt(1);
    people.insertAt(1, { name: 'Kazuki' });
    people.pushObject({ name: 'Firestone' });
    people.pushObject({ name: 'McMunch' });
    people.removeAt(2);
  });

  assertHTML(view, 'Steve HoltKazukiFirestoneMcMunch');
});

QUnit.test('it does not mark each option tag as selected', function() {
  var selectView = EmberView.create({
    template: compile('<select id="people-select"><option value="">Please select a name</option>{{#each view.people}}<option value={{name}}>{{name}}</option>{{/each}}</select>'),
    people: people
  });

  runAppend(selectView);

  equal(selectView.$('option').length, 3, 'renders 3 <option> elements');

  equal(selectView.$().find(':selected').text(), 'Please select a name', 'first option is selected');

  run(function() {
    people.pushObject({ name: 'Black Francis' });
  });

  equal(selectView.$().find(':selected').text(), 'Please select a name', 'first option is selected');

  equal(selectView.$('option').length, 4, 'renders an additional <option> element when an object is added');

  runDestroy(selectView);
});

QUnit.test('View should not use keyword incorrectly - Issue #1315', function() {
  runDestroy(view);

  view = EmberView.create({
    container: container,
    template: compile('{{#each view.content as |value|}}{{value}}-{{#each view.options as |option|}}{{option.value}}:{{option.label}} {{/each}}{{/each}}'),

    content: A(['X', 'Y']),
    options: A([
      { label: 'One', value: 1 },
      { label: 'Two', value: 2 }
    ])
  });

  runAppend(view);

  equal(view.$().text(), 'X-1:One 2:Two Y-1:One 2:Two ');
});

QUnit.test('it works inside a ul element', function() {
  var ulView = EmberView.create({
    template: compile('<ul>{{#each view.people}}<li>{{name}}</li>{{/each}}</ul>'),
    people: people
  });

  runAppend(ulView);

  equal(ulView.$('li').length, 2, 'renders two <li> elements');

  run(function() {
    people.pushObject({ name: 'Black Francis' });
  });

  equal(ulView.$('li').length, 3, 'renders an additional <li> element when an object is added');

  runDestroy(ulView);
});

QUnit.test('it works inside a table element', function() {
  var tableView = EmberView.create({
    template: compile('<table><tbody>{{#each view.people}}<tr><td>{{name}}</td></tr>{{/each}}</tbody></table>'),
    people: people
  });

  runAppend(tableView);

  equal(tableView.$('td').length, 2, 'renders two <td> elements');

  run(function() {
    people.pushObject({ name: 'Black Francis' });
  });

  equal(tableView.$('td').length, 3, 'renders an additional <td> element when an object is added');

  run(function() {
    people.insertAt(0, { name: 'Kim Deal' });
  });

  equal(tableView.$('td').length, 4, 'renders an additional <td> when an object is inserted at the beginning of the array');

  runDestroy(tableView);
});

QUnit.test('it supports {{itemView=}}', function() {
  var itemView = EmberView.extend({
    template: compile('itemView:{{name}}')
  });

  runDestroy(view);
  view = EmberView.create({
    template: compile('{{each view.people itemView="anItemView"}}'),
    people: people,
    container: container
  });

  registry.register('view:anItemView', itemView);

  runAppend(view);

  assertText(view, 'itemView:Steve HoltitemView:Annabelle');
});


QUnit.test('it defers all normalization of itemView names to the resolver', function() {
  var itemView = EmberView.extend({
    template: compile('itemView:{{name}}')
  });

  runDestroy(view);
  view = EmberView.create({
    template: compile('{{each view.people itemView="an-item-view"}}'),
    people: people,
    container: container
  });

  registry.register('view:an-item-view', itemView);
  runAppend(view);

  assertText(view, 'itemView:Steve HoltitemView:Annabelle');
});

QUnit.test('it supports {{itemViewClass=}} with global (DEPRECATED)', function() {
  runDestroy(view);
  view = EmberView.create({
    template: compile('{{each view.people itemViewClass=MyView}}'),
    people: people,
    container: container
  });

  var deprecation = /Global lookup of MyView from a Handlebars template is deprecated/;

  expectDeprecation(function() {
    runAppend(view);
  }, deprecation);

  assertText(view, 'Steve HoltAnnabelle');
});

QUnit.test('it supports {{itemViewClass=}} via container', function() {
  runDestroy(view);
  view = EmberView.create({
    container: container,
    template: compile('{{each view.people itemViewClass="my-view"}}'),
    people: people
  });

  runAppend(view);

  assertText(view, 'Steve HoltAnnabelle');
});

QUnit.test('it supports {{itemViewClass=}} with each view tagName (DEPRECATED)', function() {
  runDestroy(view);
  view = EmberView.create({
    template: compile('{{each view.people itemViewClass=MyView tagName="ul"}}'),
    people: people,
    container: container
  });

  runAppend(view);
  equal(view.$('ul').length, 1, 'rendered ul tag');
  equal(view.$('ul li').length, 2, 'rendered 2 li tags');
  equal(view.$('ul li').text(), 'Steve HoltAnnabelle');
});

QUnit.test('it supports {{itemViewClass=}} with tagName in itemViewClass (DEPRECATED)', function() {
  runDestroy(view);
  registry.register('view:li-view', EmberView.extend({
    tagName: 'li'
  }));

  view = EmberView.create({
    template: compile('<ul>{{#each view.people itemViewClass="li-view" as |item|}}{{item.name}}{{/each}}</ul>'),
    people: people,
    container: container
  });

  runAppend(view);

  equal(view.$('ul').length, 1, 'rendered ul tag');
  equal(view.$('ul li').length, 2, 'rendered 2 li tags');
  equal(view.$('ul li').text(), 'Steve HoltAnnabelle');
});

QUnit.test('it supports {{itemViewClass=}} with {{else}} block (DEPRECATED)', function() {
  runDestroy(view);

  view = EmberView.create({
    template: compile(`
      {{~#each view.people itemViewClass="my-view" as |item|~}}
        {{item.name}}
      {{~else~}}
        No records!
      {{~/each}}`),
    people: A(),
    container: container
  });

  runAppend(view);

  equal(view.$().text(), 'No records!');
});

QUnit.test('it supports {{emptyView=}}', function() {
  var emptyView = EmberView.extend({
    template: compile('emptyView:sad panda')
  });

  runDestroy(view);

  view = EmberView.create({
    template: compile('{{each view.people emptyView="anEmptyView"}}'),
    people: A(),
    container: container
  });

  registry.register('view:anEmptyView', emptyView);

  runAppend(view);

  assertText(view, 'emptyView:sad panda');
});

QUnit.test('it defers all normalization of emptyView names to the resolver', function() {
  var emptyView = EmberView.extend({
    template: compile('emptyView:sad panda')
  });

  runDestroy(view);

  view = EmberView.create({
    template: compile('{{each view.people emptyView="an-empty-view"}}'),
    people: A(),
    container: container
  });

  registry.register('view:an-empty-view', emptyView);

  runAppend(view);

  assertText(view, 'emptyView:sad panda');
});

QUnit.test('it supports {{emptyViewClass=}} with global (DEPRECATED)', function() {
  runDestroy(view);

  view = EmberView.create({
    template: compile('{{each view.people emptyViewClass=MyEmptyView}}'),
    people: A(),
    container: container
  });

  var deprecation = /Global lookup of MyEmptyView from a Handlebars template is deprecated/;

  expectDeprecation(function() {
    runAppend(view);
  }, deprecation);

  assertText(view, 'I\'m empty');
});

QUnit.test('it supports {{emptyViewClass=}} via container', function() {
  runDestroy(view);

  view = EmberView.create({
    container: container,
    template: compile('{{each view.people emptyViewClass="my-empty-view"}}'),
    people: A()
  });

  runAppend(view);

  assertText(view, 'I\'m empty');
});

QUnit.test('it supports {{emptyViewClass=}} with tagName (DEPRECATED)', function() {
  runDestroy(view);

  view = EmberView.create({
    template: compile('{{each view.people emptyViewClass=MyEmptyView tagName="b"}}'),
    people: A(),
    container: container
  });

  runAppend(view);

  equal(view.$('b').length, 1, 'rendered b tag');
  equal(view.$('b').text(), 'I\'m empty');
});

QUnit.test('it supports {{emptyViewClass=}} with in format', function() {
  runDestroy(view);

  view = EmberView.create({
    container: container,
    template: compile('{{each person in view.people emptyViewClass="my-empty-view"}}'),
    people: A()
  });

  runAppend(view);

  assertText(view, 'I\'m empty');
});

QUnit.test('it uses {{else}} when replacing model with an empty array', function() {
  runDestroy(view);
  view = EmberView.create({
    template: compile('{{#each view.items}}{{this}}{{else}}Nothing{{/each}}'),
    items: A(['one', 'two'])
  });

  runAppend(view);

  assertHTML(view, 'onetwo');

  run(function() {
    view.set('items', A());
  });

  assertHTML(view, 'Nothing');
});

QUnit.test('it uses {{else}} when removing all items in an array', function() {
  var items = A(['one', 'two']);
  runDestroy(view);
  view = EmberView.create({
    template: compile('{{#each view.items}}{{this}}{{else}}Nothing{{/each}}'),
    items
  });

  runAppend(view);

  assertHTML(view, 'onetwo');

  run(function() {
    items.shiftObject();
    items.shiftObject();
  });

  assertHTML(view, 'Nothing');
});

QUnit.test('it can move to and from {{else}} properly when the backing array gains and looses items (#11140)', function() {
  var items = A(['one', 'two']);
  runDestroy(view);
  view = EmberView.create({
    template: compile('{{#each view.items}}{{this}}{{else}}Nothing{{/each}}'),
    items
  });

  runAppend(view);

  assertHTML(view, 'onetwo');

  run(function() {
    items.shiftObject();
    items.shiftObject();
  });

  assertHTML(view, 'Nothing');

  run(function() {
    items.pushObject('three');
    items.pushObject('four');
  });

  assertHTML(view, 'threefour');

  run(function() {
    items.shiftObject();
    items.shiftObject();
  });

  assertHTML(view, 'Nothing');
});

QUnit.test('views inside #each preserve the new context [DEPRECATED]', function() {
  runDestroy(view);

  var controller = A([{ name: 'Adam' }, { name: 'Steve' }]);

  view = EmberView.create({
    container: container,
    controller: controller,
    template: compile('{{#each controller}}{{#view}}{{name}}{{/view}}{{/each}}')
  });


  expectDeprecation(function() {
    runAppend(view);
  }, eachDeprecation);

  equal(view.$().text(), 'AdamSteve');
});

function testEachWithItem(moduleName, useBlockParams) {
  QUnit.module(moduleName, {
    setup() {
      registry = new Registry();
      container = registry.container();

      registry.register('view:toplevel', EmberView.extend());
      registry.register('view:-legacy-each', LegacyEachView);
    },
    teardown() {
      runDestroy(container);
      runDestroy(view);
      container = view = null;
    }
  });

  QUnit.test('#each accepts a name binding', function() {
    view = EmberView.create({
      template: templateFor('{{#EACH|view.items|item}}{{view.title}} {{item}}{{/each}}', useBlockParams),
      title: 'My Cool Each Test',
      items: A([1, 2])
    });

    runAppend(view);

    equal(view.$().text(), 'My Cool Each Test 1My Cool Each Test 2');
  });

  QUnit.test('#each accepts a name binding and does not change the context', function() {
    var controller = EmberController.create({
      name: 'bob the controller'
    });
    var obj = EmberObject.create({
      name: 'henry the item'
    });

    view = EmberView.create({
      template: templateFor('{{#EACH|view.items|item}}{{name}}{{/each}}', useBlockParams),
      title: 'My Cool Each Test',
      items: A([obj]),
      controller: controller
    });

    runAppend(view);

    equal(view.$().text(), 'bob the controller');
  });


  QUnit.test('#each accepts a name binding and can display child properties', function() {
    view = EmberView.create({
      template: templateFor('{{#EACH|view.items|item}}{{view.title}} {{item.name}}{{/each}}', useBlockParams),
      title: 'My Cool Each Test',
      items: A([{ name: 1 }, { name: 2 }])
    });

    runAppend(view);

    equal(view.$().text(), 'My Cool Each Test 1My Cool Each Test 2');
  });

  QUnit.test('#each accepts \'this\' as the right hand side', function() {
    view = EmberView.create({
      template: templateFor('{{#EACH|this|item}}{{view.title}} {{item.name}}{{/each}}', useBlockParams),
      title: 'My Cool Each Test',
      controller: A([{ name: 1 }, { name: 2 }])
    });

    runAppend(view);

    equal(view.$().text(), 'My Cool Each Test 1My Cool Each Test 2');
  });

  if (!useBlockParams) {
    QUnit.test('views inside #each preserve the new context [DEPRECATED]', function() {
      var controller = A([{ name: 'Adam' }, { name: 'Steve' }]);

      view = EmberView.create({
        container: container,
        controller: controller,
        template: compile('{{#each controller}}{{#view}}{{name}}{{/view}}{{/each}}', useBlockParams)
      });

      expectDeprecation(function() {
        runAppend(view);
      }, eachDeprecation);

      equal(view.$().text(), 'AdamSteve');
    });
  }

  QUnit.test('it doesn\'t assert when the morph tags have the same parent', function() {
    view = EmberView.create({
      controller: A(['Cyril', 'David']),
      template: templateFor('<table><tbody>{{#EACH|this|name}}<tr><td>{{name}}</td></tr>{{/each}}</tbody></table>', useBlockParams)
    });

    runAppend(view);

    ok(true, 'No assertion from valid template');
  });

  QUnit.test('locals in stable loops update when the list is updated', function() {
    expect(3);

    var list = [{ key: 'adam', name: 'Adam' }, { key: 'steve', name: 'Steve' }];
    view = EmberView.create({
      queries: list,
      template: compile('{{#each view.queries key="key" as |query|}}{{query.name}}{{/each}}', true)
    });
    runAppend(view);
    equal(view.$().text(), 'AdamSteve');

    run(function() {
      list.unshift({ key: 'bob', name: 'Bob' });
      view.set('queries', list);
      view.notifyPropertyChange('queries');
    });

    equal(view.$().text(), 'BobAdamSteve');

    run(function() {
      view.set('queries', [{ key: 'bob', name: 'Bob' }, { key: 'steve', name: 'Steve' }]);
      view.notifyPropertyChange('queries');
    });

    equal(view.$().text(), 'BobSteve');
  });

  if (useBlockParams) {
    QUnit.test('the index is passed as the second parameter to #each blocks', function() {
      expect(3);

      var adam = { name: 'Adam' };
      view = EmberView.create({
        controller: A([adam, { name: 'Steve' }]),
        template: templateFor('{{#each this as |person index|}}{{index}}. {{person.name}}{{/each}}', true)
      });
      runAppend(view);
      equal(view.$().text(), '0. Adam1. Steve');

      run(function() {
        view.get('controller').unshiftObject({ name: 'Bob' });
      });
      equal(view.$().text(), '0. Bob1. Adam2. Steve');

      run(function() {
        view.get('controller').removeObject(adam);
      });
      equal(view.$().text(), '0. Bob1. Steve');
    });
  }
}

QUnit.test('context switching deprecation is printed when no items are present', function() {
  runDestroy(view);
  view = EmberView.create({
    template: compile('{{#each view.items}}{{this}}{{else}}Nothing{{/each}}')
  });

  expectDeprecation(function() {
    runAppend(view);
  }, /Using the context switching form of \{\{each\}\} is deprecated/);

  assertHTML(view, 'Nothing');
});

QUnit.test('a string key can be used with {{each}}', function() {
  runDestroy(view);
  view = EmberView.create({
    items: [
      { id: 'foo' },
      { id: 'bar' },
      { id: 'baz' }
    ],
    template: compile('{{#each view.items key=\'id\' as |item|}}{{item.id}}{{/each}}')
  });

  runAppend(view);

  equal(view.$().text(), 'foobarbaz');
});

QUnit.test('a numeric key can be used with {{each}}', function() {
  runDestroy(view);
  view = EmberView.create({
    items: [
      { id: 1 },
      { id: 2 },
      { id: 3 }
    ],
    template: compile('{{#each view.items key=\'id\' as |item|}}{{item.id}}{{/each}}')
  });

  runAppend(view);

  equal(view.$().text(), '123');
});

QUnit.test('can specify `@index` to represent the items index in the array being iterated', function() {
  runDestroy(view);
  view = EmberView.create({
    items: [
      { id: 1 },
      { id: 2 },
      { id: 3 }
    ],
    template: compile('{{#each view.items key=\'@index\' as |item|}}{{item.id}}{{/each}}')
  });

  runAppend(view);

  equal(view.$().text(), '123');
});

QUnit.test('can specify `@guid` to represent the items GUID [DEPRECATED]', function() {
  expectDeprecation(`Using '@guid' with the {{each}} helper, is deprecated. Switch to '@identity' or remove 'key=' from your template.`);

  runDestroy(view);
  view = EmberView.create({
    items: [
      { id: 1 },
      { id: 2 },
      { id: 3 }
    ],
    template: compile('{{#each view.items key=\'@guid\' as |item|}}{{item.id}}{{/each}}')
  });

  runAppend(view);

  equal(view.$().text(), '123');
});

QUnit.test('can specify `@item` to represent primitive items', function() {
  expectDeprecation(`Using '@item' with the {{each}} helper, is deprecated. Switch to '@identity' or remove 'key=' from your template.`);

  runDestroy(view);
  view = EmberView.create({
    items: [1, 2, 3],
    template: compile('{{#each view.items key=\'@item\' as |item|}}{{item}}{{/each}}')
  });

  runAppend(view);

  equal(view.$().text(), '123');

  run(function() {
    set(view, 'items', ['foo', 'bar', 'baz']);
  });

  equal(view.$().text(), 'foobarbaz');
});

QUnit.test('can specify `@identity` to represent primitive items', function() {
  runDestroy(view);
  view = EmberView.create({
    items: [1, 2, 3],
    template: compile('{{#each view.items key=\'@identity\' as |item|}}{{item}}{{/each}}')
  });

  runAppend(view);

  equal(view.$().text(), '123');

  run(function() {
    set(view, 'items', ['foo', 'bar', 'baz']);
  });

  equal(view.$().text(), 'foobarbaz');
});

QUnit.test('can specify `@identity` to represent mixed object and primitive items', function() {
  runDestroy(view);
  view = EmberView.create({
    items: [1, { id: 2 }, 3],
    template: compile('{{#each view.items key=\'@identity\' as |item|}}{{#if item.id}}{{item.id}}{{else}}{{item}}{{/if}}{{/each}}')
  });

  runAppend(view);

  equal(view.$().text(), '123');

  run(function() {
    set(view, 'items', ['foo', { id: 'bar' }, 'baz']);
  });

  equal(view.$().text(), 'foobarbaz');
});

QUnit.test('duplicate keys trigger a useful error (temporary until we can deal with this properly in HTMLBars)', function() {
  runDestroy(view);
  view = EmberView.create({
    items: ['a', 'a', 'a'],
    template: compile('{{#each view.items as |item|}}{{item}}{{/each}}')
  });

  throws(
    function() {
      runAppend(view);
    },
    `Duplicate key found ('a') for '{{each}}' helper, please use a unique key or switch to '{{#each model key="@index"}}{{/each}}'.`
  );
});

QUnit.test('pushing a new duplicate key will trigger a useful error (temporary until we can deal with this properly in HTMLBars)', function() {
  runDestroy(view);
  view = EmberView.create({
    items: A(['a', 'b', 'c']),
    template: compile('{{#each view.items as |item|}}{{item}}{{/each}}')
  });

  runAppend(view);

  throws(
    function() {
      run(function() {
        view.get('items').pushObject('a');
      });
    },
    `Duplicate key found ('a') for '{{each}}' helper, please use a unique key or switch to '{{#each model key="@index"}}{{/each}}'.`
  );
});

testEachWithItem('{{#each bar as |foo|}}', true);

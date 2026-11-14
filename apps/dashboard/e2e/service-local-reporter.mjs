export default class ServiceLocalReporter {
  onBegin(_config,suite){this.tests=suite.allTests();}
  onEnd(result){
    if(result.status!=='passed'||!this.tests?.length||this.tests.some(test=>
      test.results.length!==1||test.results[0].status!=='passed'))return{status:'failed'};
  }
}

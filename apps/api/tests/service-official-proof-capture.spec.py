"""Pure observer contracts. No subprocess, Git, official-main, application or provider is run."""
from pathlib import Path
import importlib.util, json, subprocess, sys, tempfile, unittest
sys.dont_write_bytecode=True
BASE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("capture_helper",BASE/"service-official-proof-capture.py")
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
class ObserverTests(unittest.TestCase):
    def make(self,original,plan=None,logs=True):
        directory=Path(self.temp.name)
        if logs:(directory/"logs").mkdir(exist_ok=True)
        return helper.CommandObserver(original,plan or [{"kind":"proof","cid":"C1","command":"literal"}],directory,directory)
    def setUp(self):self.temp=tempfile.TemporaryDirectory()
    def tearDown(self):self.temp.cleanup()
    def test_arguments_environment_timeout_and_result_identity_are_unchanged(self):
        calls=[];env={"PRIVATE":"must-not-be-recorded"}
        result=subprocess.CompletedProcess("literal",0,"observed stdout\n","observed stderr\n")
        def original(*args,**kwargs):calls.append((args,kwargs));return result
        observer=self.make(original)
        kwargs={"cwd":self.temp.name,"shell":True,"capture_output":True,"text":True,"env":env,"timeout":37}
        actual=observer("literal",**kwargs)
        self.assertIs(actual,result);self.assertEqual(len(calls),1);self.assertEqual(calls[0][0],("literal",))
        self.assertEqual(calls[0][1],kwargs);self.assertIs(calls[0][1]["env"],env)
        self.assertEqual(observer.entries[0]["returnCode"],0)
        self.assertNotIn("must-not-be-recorded",json.dumps(observer.entries))
    def test_nonzero_return_is_not_rewritten(self):
        result=subprocess.CompletedProcess("literal",7,"out","err");observer=self.make(lambda *a,**k:result)
        self.assertIs(observer("literal",cwd=self.temp.name,shell=True,capture_output=True,text=True),result)
        self.assertEqual(observer.entries[0]["returnCode"],7)
    def test_original_exception_is_not_swallowed(self):
        failure=RuntimeError("original")
        def original(*a,**k):raise failure
        observer=self.make(original)
        with self.assertRaises(RuntimeError) as found:observer("literal",cwd=self.temp.name,shell=True,capture_output=True,text=True)
        self.assertIs(found.exception,failure);self.assertEqual(observer.entries,[])
    def test_capture_failure_does_not_change_result(self):
        result=subprocess.CompletedProcess("literal",0,"out","err");observer=self.make(lambda *a,**k:result,logs=False)
        self.assertIs(observer("literal",cwd=self.temp.name,shell=True,capture_output=True,text=True),result)
        self.assertEqual(observer.entries,[]);self.assertTrue(observer.errors)
    def test_unplanned_command_is_not_logged_or_reexecuted(self):
        calls=[];result=subprocess.CompletedProcess("other",0,"out","err")
        def original(*a,**k):calls.append(a);return result
        observer=self.make(original)
        self.assertIs(observer("other",cwd=self.temp.name,shell=True,capture_output=True,text=True),result)
        self.assertEqual(len(calls),1);self.assertEqual(observer.entries,[]);self.assertEqual(observer.errors,["ValueError"])
    def test_nonproof_list_command_is_delegated_without_recording(self):
        result=subprocess.CompletedProcess(["git"],0,"not captured","");observer=self.make(lambda *a,**k:result)
        self.assertIs(observer(["git"],cwd=self.temp.name,capture_output=True,text=True),result)
        self.assertEqual(observer.entries,[])
    def test_build_is_not_counted_as_synthetic_cases(self):
        result=subprocess.CompletedProcess("literal",0,"build","")
        observer=self.make(lambda *a,**k:result,[{"kind":"build","buildIndex":1,"command":"literal"}])
        observer("literal",cwd=self.temp.name,shell=True,capture_output=True,text=True)
        self.assertEqual(observer.entries[0]["kind"],"build");self.assertNotIn("counts",observer.entries[0])
    def test_mutation_driver_and_repeated_positive_command_are_separate(self):
        positive=subprocess.CompletedProcess("literal",0,"positive","")
        driver=subprocess.CompletedProcess(["python","mutate.py"],0,"three canonical kill rows","")
        calls=[]
        def original(*args,**kwargs):
            calls.append(args)
            return driver if isinstance(args[0],list) else positive
        plan=[{"kind":"proof","cid":"C1","command":"literal"},{"kind":"proof","cid":"C2","command":"literal"}]
        observer=self.make(original,plan)
        options=dict(cwd=self.temp.name,shell=True,capture_output=True,text=True)
        self.assertIs(observer("literal",**options),positive)
        self.assertIs(observer(["python","mutate.py"],cwd=self.temp.name,capture_output=True,text=True),driver)
        self.assertIs(observer("literal",**options),positive)
        self.assertEqual(len(calls),3);self.assertEqual(len(observer.entries),2)
        self.assertEqual([r["phase"] for r in observer.entries],["official-positive-proof"]*2)
        self.assertEqual(observer.errors,[])
    def test_nonzero_mutant_child_is_delegated_not_positive_coverage(self):
        mutant=subprocess.CompletedProcess(["node","mutant"],1,"expected killed mutation","")
        observer=self.make(lambda *a,**k:mutant)
        self.assertIs(observer(["node","mutant"],cwd=self.temp.name,capture_output=True,text=True),mutant)
        self.assertEqual(observer.entries,[]);self.assertEqual(observer.errors,[])
if __name__=="__main__":unittest.main()


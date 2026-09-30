       IDENTIFICATION DIVISION.
       PROGRAM-ID. MQPARM.
      * A batch job connects to whichever queue manager its PARM names.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 W00-QM-NAME    PIC X(48).
       01 W03-HCONN      PIC S9(9) BINARY.
       01 W00-COMP-CODE  PIC S9(9) BINARY.
       01 W00-REASON     PIC S9(9) BINARY.
       LINKAGE SECTION.
       01 LS-PARM.
          05 LS-LEN      PIC S9(4) COMP.
          05 LS-QM       PIC X(48).
       PROCEDURE DIVISION USING LS-PARM.
           MOVE LS-QM TO W00-QM-NAME
           CALL 'MQCONN' USING W00-QM-NAME W03-HCONN
                               W00-COMP-CODE W00-REASON
           GOBACK.
